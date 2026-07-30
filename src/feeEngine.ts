// OriLife — bộ định giá phí (fee engine). Một tác vụ người dùng → FeeQuote: tổng phí
// (oil LAMP) + phân rã về 3 bucket treasury. Tổng quát hoá field-reid/animal_fee.py.
//
// Luồng:
//   fee_usd = clamp( (base + value_add) × demand × anchor_tier × event ,  ≤ trần )
//   fee_oil = round(fee_usd / lampUsd × OIL_PER_LAMP)        (USD → LAMP → oil)
//   chia fee_oil (bigint, floor) về 3 bucket — anchor nhận PHẦN DƯ để Σ bucket == fee_oil.
//
// Bảo toàn (then chốt cho on-chain): Σ bucket.oil == fee_oil TUYỆT ĐỐI (không hụt 1 oil).
// Đây là điều kiện để giao dịch Collect giữ Σout=Σin per-asset (custody.ak C-COL-4).

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
  /** Khoá tác vụ (xem tasks.ts). */
  task: string;
  /** Giá trị tài sản khai báo (USD) — cho tác vụ value-based. */
  declaredValueUsd?: number;
  /** Ghi đè bậc neo. Tác vụ on-chain KHÔNG được hạ dưới defaultAnchorTier (L-1). */
  anchorTier?: AnchorTier;
  /** Số sự kiện vòng đời đã ghi (chia sẻ chi phí cố định; mặc định 1). */
  lifecycleEvents?: number;
  /**
   * Hệ số cầu [0.5, 3.0] (mặc định 1.0).
   * ⚠️ TRUSTED SERVER INPUT — PHẢI do server tính qua DemandController/oracle, KHÔNG nhận
   * thẳng từ client (nếu không, client ghim 0.5 trả phí tối thiểu — H-1). Tầng API phải
   * chặn field này từ client.
   */
  demandFactor?: number;
}

/** Thứ tự bậc neo (để chặn hạ thấp dưới mặc định cho tác vụ on-chain). */
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

/** floor(x × bps / 10000) trên bigint (x ≥ 0 ⇒ trunc == floor). */
function bpsOf(x: bigint, bps: bigint): bigint {
  return (x * bps) / BPS_DENOM;
}

/**
 * Cập nhật demand_factor từ tín hiệu cung/cầu MAGIC (EMA, clamp ±10%/bước, bound).
 * Mirror animal_fee.demand_factor_from_signals. Cầu>cung → tăng phí; cung>cầu → giảm.
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
 * Bộ điều khiển CẦU server-side: giữ state EMA demand_factor, cập nhật từ tín hiệu cung/cầu
 * (đã tổng hợp/đã ký — KHÔNG phải self-report). Đây là NGUỒN demand_factor hợp lệ truyền vào
 * quoteFee; client KHÔNG được tự đặt (H-1). Tín hiệu nên đến từ MAGIC AppEconomics actual
 * consumption (oracle) — wire ở v1.1 (H-2, còn là gap).
 */
export class DemandController {
  private df: number;
  constructor(initial = 1.0) {
    this.df = clamp(initial, DEMAND_FACTOR_MIN, DEMAND_FACTOR_MAX);
  }
  /** Cập nhật từ tín hiệu (EMA, clamp ±10%/bước, bound). Trả demand_factor mới. */
  update(magicConsumed: number, magicGenerated: number, utilization = 0): number {
    this.df = demandFactorFromSignals(this.df, magicConsumed, magicGenerated, utilization);
    return this.df;
  }
  current(): number {
    return this.df;
  }
}

/**
 * Chia tổng phí (oil) về 3 bucket theo cắt giao thức + tỉ lệ 4 tài nguyên.
 * ANCHOR nhận phần dư (remainder − storage − compute − bandwidth) → Σ == feeOil tuyệt đối.
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
  const anchorOil = remainder - storageOil - computeOil - bandwidthOil; // hấp thụ dư
  const lampnetOil = storageOil + computeOil + bandwidthOil;
  return { protocolOil, lampnetOil, anchorOil, storageOil, computeOil, bandwidthOil };
}

/** Định giá một tác vụ → FeeQuote. */
export function quoteFee(input: QuoteInput): FeeQuote {
  const t = getTask(input.task);
  let anchorTier = input.anchorTier ?? t.defaultAnchorTier;
  // L-1: tác vụ on-chain không cho hạ bậc neo dưới mặc định (chống né phí neo bắt buộc).
  if (t.onChain && TIER_ORDER[anchorTier] < TIER_ORDER[t.defaultAnchorTier]) {
    anchorTier = t.defaultAnchorTier;
  }
  const demandFactor = clamp(input.demandFactor ?? 1.0, DEMAND_FACTOR_MIN, DEMAND_FACTOR_MAX);
  const events = Math.max(1, Math.floor(input.lifecycleEvents ?? 1));

  // 1. Phần value-based (chỉ tác vụ valueBps>0), có SÀN chống khai thấp.
  let valueAddUsd = 0;
  if (t.valueBps > 0) {
    const effectiveValue = Math.max(input.declaredValueUsd ?? 0, t.floorValueUsd);
    valueAddUsd = effectiveValue * (t.valueBps / 10000);
  }

  // 2. Nhân hệ số cầu × bậc neo × sự kiện.
  const eventMult = 1.0 + 0.15 * Math.log2(events);
  const tierMult = ANCHOR_TIER_MULT[anchorTier];
  const rawUsd = (t.baseFeeUsd + valueAddUsd) * demandFactor * tierMult * eventMult;

  // 3. TRẦN cứng: ≤ min(MAX_FRACTION × truyền thống, trần tuyệt đối USD) — M-2 chặn DAO
  //    thổi traditionalCost để vượt trần.
  const ceilingUsd = Math.min(t.traditionalCostUsd * MAX_FRACTION_OF_TRADITIONAL, MAX_FEE_USD_ABSOLUTE);
  const capped = rawUsd > ceilingUsd;
  const feeUsd = Math.max(0, Math.min(rawUsd, ceilingUsd));

  // 4. USD → oil bằng BIGINT (tất định cross-node + tránh tràn float >2^53 — H-3).
  //    feeOil = feeUsdMicro × OIL_PER_LAMP / lampUsdMicro. micro-USD nhỏ → float an toàn.
  const lampUsd = getLampUsd();
  const feeUsdMicro = BigInt(Math.round(feeUsd * 1e6));
  const lampUsdMicro = BigInt(Math.round(lampUsd * 1e6)); // ≥ 1 do daoSetLampUsd kẹp biên
  let feeOil = lampUsdMicro > 0n ? (feeUsdMicro * OIL_PER_LAMP) / lampUsdMicro : 0n;
  // L-2: sàn chống làm tròn về 0 cho tác vụ có chi phí thật (feeUsd > 0 nhưng feeOil = 0).
  if (feeOil === 0n && feeUsd > 0) feeOil = MIN_FEE_OIL;

  // 5. Chia về bucket (bigint, anchor hấp thụ dư).
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
