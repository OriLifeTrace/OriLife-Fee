// OriLife — the fee engine. One user task in, one FeeQuote out: the total fee (in LAMP oil)
// plus its split across the three treasury buckets. A generalisation of field-reid/animal_fee.py.
//
// The flow:
//   fee_usd = clamp( (base + value_add) × demand × anchor_tier × event ,  <= cap )
//   fee_oil = round(fee_usd / lampUsd × OIL_PER_LAMP)        (USD -> LAMP -> oil)
//   split fee_oil (bigint, floor) across three buckets — anchor takes the REMAINDER so that
//   Σ buckets == fee_oil.
//
// Conservation is the load-bearing property here: Σ bucket.oil == fee_oil EXACTLY, not one oil
// short. That is what lets the Collect transaction keep Σout = Σin per asset (custody.ak C-COL-4).

import {
  OIL_PER_LAMP, PROTOCOL_CUT_BPS, RESOURCE_SPLIT_BPS, ANCHOR_TIER_MULT,
  MAX_FRACTION_OF_TRADITIONAL, MAX_FEE_USD_ABSOLUTE, MIN_FEE_OIL,
  DEMAND_FACTOR_MIN, DEMAND_FACTOR_MAX,
  DEMAND_STEP_CAP, DEMAND_SENSITIVITY, getLampUsd, type AnchorTier,
} from "./params.js";
import { BUCKET, type BucketName } from "./buckets.js";
import { getTask } from "./tasks.js";

const BPS_DENOM = 10_000n;

export interface QuoteInput {
  /** Task key (see tasks.ts). */
  task: string;
  /** Declared asset value in USD — for value-based tasks. */
  declaredValueUsd?: number;
  /** Override the anchoring tier. An on-chain task may NOT go below defaultAnchorTier (L-1). */
  anchorTier?: AnchorTier;
  /** How many lifecycle events are already recorded (shares the fixed cost; defaults to 1). */
  lifecycleEvents?: number;
  /**
   * Demand factor in [0.5, 3.0] (defaults to 1.0).
   * WARNING — TRUSTED SERVER INPUT. It MUST be computed server-side through DemandController or
   * an oracle, and must never be taken straight from a client: a client that pins it to 0.5 pays
   * the minimum fee forever (H-1). The API layer is responsible for stripping this field from
   * client requests.
   */
  demandFactor?: number;
}

/** Tier ordering, used to stop an on-chain task dropping below its default. */
const TIER_ORDER: Record<AnchorTier, number> = {
  no_anchor: 0, batch_daily: 1, milestone: 2, immediate: 3,
};

export interface BucketShare {
  bucket: BucketName;
  category: bigint;
  oil: bigint;
}

export interface FeeQuote {
  task: string;
  feeUsd: number;
  feeLamp: number;
  feeOil: bigint;
  buckets: BucketShare[];
  breakdownUsd: { storage: number; compute: number; bandwidth: number; anchor: number };
  protocolCutOil: bigint;
  traditionalCostUsd: number;
  advantagePct: number;
  capped: boolean;
  demandFactor: number;
  anchorTier: AnchorTier;
  daoGoverned: true;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** floor(x × bps / 10000) over bigint (for x >= 0, truncation equals floor). */
function bpsOf(x: bigint, bps: bigint): bigint {
  return (x * bps) / BPS_DENOM;
}

/**
 * Update demand_factor from MAGIC supply/demand signals (EMA, clamped to ±10% per step, bounded).
 * Mirrors animal_fee.demand_factor_from_signals. Demand above supply raises the fee; supply above
 * demand lowers it.
 */
export function demandFactorFromSignals(
  prev: number,
  magicConsumed: number,
  magicGenerated: number,
  utilization = 0,
): number {
  if (magicGenerated <= 0) return clamp(prev, DEMAND_FACTOR_MIN, DEMAND_FACTOR_MAX);
  const ratio = (magicConsumed + 0.5 * utilization * magicGenerated) / magicGenerated;
  const rawDelta = (ratio - 1.0) * DEMAND_SENSITIVITY;
  const bounded = clamp(rawDelta, -DEMAND_STEP_CAP, DEMAND_STEP_CAP);
  const next = prev * (1.0 + bounded);
  return clamp(next, DEMAND_FACTOR_MIN, DEMAND_FACTOR_MAX);
}

/**
 * The server-side demand controller: holds the demand_factor EMA state and updates it from
 * supply/demand signals that are aggregated and signed — never self-reported. This is the only
 * legitimate SOURCE of the demand_factor passed to quoteFee; a client must never set it (H-1).
 * The signals should come from MAGIC AppEconomics actual consumption via an oracle — wiring that
 * up is deferred to v1.1 and is still an open gap (H-2).
 */
export class DemandController {
  private df: number;
  constructor(initial = 1.0) {
    this.df = clamp(initial, DEMAND_FACTOR_MIN, DEMAND_FACTOR_MAX);
  }
  /** Update from signals (EMA, clamped to ±10% per step, bounded). Returns the new factor. */
  update(magicConsumed: number, magicGenerated: number, utilization = 0): number {
    this.df = demandFactorFromSignals(this.df, magicConsumed, magicGenerated, utilization);
    return this.df;
  }
  current(): number {
    return this.df;
  }
}

/**
 * Split the total fee (oil) across the three buckets: protocol cut first, then the four-resource
 * ratio. ANCHOR takes the remainder (remainder − storage − compute − bandwidth), which makes
 * Σ buckets == feeOil exactly.
 */
export function splitOil(feeOil: bigint): {
  protocolOil: bigint; lampnetOil: bigint; anchorOil: bigint;
  storageOil: bigint; computeOil: bigint; bandwidthOil: bigint;
} {
  const protocolOil = bpsOf(feeOil, PROTOCOL_CUT_BPS);
  const remainder = feeOil - protocolOil;
  const storageOil = bpsOf(remainder, RESOURCE_SPLIT_BPS.storage);
  const computeOil = bpsOf(remainder, RESOURCE_SPLIT_BPS.compute);
  const bandwidthOil = bpsOf(remainder, RESOURCE_SPLIT_BPS.bandwidth);
  const anchorOil = remainder - storageOil - computeOil - bandwidthOil; // absorbs the remainder
  const lampnetOil = storageOil + computeOil + bandwidthOil;
  return { protocolOil, lampnetOil, anchorOil, storageOil, computeOil, bandwidthOil };
}

/** Price one task and return a FeeQuote. */
export function quoteFee(input: QuoteInput): FeeQuote {
  const t = getTask(input.task);
  let anchorTier = input.anchorTier ?? t.defaultAnchorTier;
  // L-1: an on-chain task cannot drop below its default tier — otherwise the mandatory
  // anchoring fee is avoidable.
  if (t.onChain && TIER_ORDER[anchorTier] < TIER_ORDER[t.defaultAnchorTier]) {
    anchorTier = t.defaultAnchorTier;
  }
  const demandFactor = clamp(input.demandFactor ?? 1.0, DEMAND_FACTOR_MIN, DEMAND_FACTOR_MAX);
  const events = Math.max(1, Math.floor(input.lifecycleEvents ?? 1));

  // 1. The value-based component (only for tasks with valueBps > 0), with a FLOOR so that
  //    under-declaring the value does not pay.
  let valueAddUsd = 0;
  if (t.valueBps > 0) {
    const effectiveValue = Math.max(input.declaredValueUsd ?? 0, t.floorValueUsd);
    valueAddUsd = effectiveValue * (t.valueBps / 10000);
  }

  // 2. Multiply by demand factor × anchoring tier × event count.
  const eventMult = 1.0 + 0.15 * Math.log2(events);
  const tierMult = ANCHOR_TIER_MULT[anchorTier];
  const rawUsd = (t.baseFeeUsd + valueAddUsd) * demandFactor * tierMult * eventMult;

  // 3. Hard cap: at most min(MAX_FRACTION × traditional cost, the absolute USD cap). The second
  //    term is M-2: it stops the DAO inflating traditionalCost to raise the ceiling.
  const ceilingUsd = Math.min(t.traditionalCostUsd * MAX_FRACTION_OF_TRADITIONAL, MAX_FEE_USD_ABSOLUTE);
  const capped = rawUsd > ceilingUsd;
  const feeUsd = Math.max(0, Math.min(rawUsd, ceilingUsd));

  // 4. USD -> oil in BIGINT, so the result is deterministic across nodes and cannot overflow a
  //    float past 2^53 (H-3). feeOil = feeUsdMicro × OIL_PER_LAMP / lampUsdMicro; micro-USD stays
  //    small enough for the float step to be exact.
  const lampUsd = getLampUsd();
  const feeUsdMicro = BigInt(Math.round(feeUsd * 1e6));
  const lampUsdMicro = BigInt(Math.round(lampUsd * 1e6)); // >= 1, because daoSetLampUsd clamps it
  let feeOil = lampUsdMicro > 0n ? (feeUsdMicro * OIL_PER_LAMP) / lampUsdMicro : 0n;
  // L-2: a floor so a task with a real cost never rounds to zero (feeUsd > 0 but feeOil == 0).
  if (feeOil === 0n && feeUsd > 0) feeOil = MIN_FEE_OIL;

  // 5. Split into buckets (bigint; anchor absorbs the remainder).
  const s = splitOil(feeOil);

  const buckets: BucketShare[] = [
    { bucket: "PROTOCOL", category: BUCKET.PROTOCOL, oil: s.protocolOil },
    { bucket: "LAMPNET_REWARD", category: BUCKET.LAMPNET_REWARD, oil: s.lampnetOil },
    { bucket: "ANCHOR", category: BUCKET.ANCHOR, oil: s.anchorOil },
  ];

  const oilToUsd = (oil: bigint): number => (Number(oil) / Number(OIL_PER_LAMP)) * lampUsd;

  return {
    task: t.key,
    feeUsd: round6(feeUsd),
    feeLamp: round6(Number(feeOil) / Number(OIL_PER_LAMP)),
    feeOil,
    buckets,
    breakdownUsd: {
      storage: round6(oilToUsd(s.storageOil)),
      compute: round6(oilToUsd(s.computeOil)),
      bandwidth: round6(oilToUsd(s.bandwidthOil)),
      anchor: round6(oilToUsd(s.anchorOil)),
    },
    protocolCutOil: s.protocolOil,
    traditionalCostUsd: t.traditionalCostUsd,
    advantagePct: t.traditionalCostUsd > 0
      ? round6(((t.traditionalCostUsd - feeUsd) / t.traditionalCostUsd) * 100)
      : 0,
    capped,
    demandFactor: round6(demandFactor),
    anchorTier,
    daoGoverned: true,
  };
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}
