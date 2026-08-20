// OriLife — DAO-governed fee economics parameters (the MagicLamp DAO tunes these per season).
//
// From first principles (inheriting and generalising field-reid/animal_fee.py to EVERY task):
//   1. Fees are anchored to the REAL cost of four resources (storage/compute/bandwidth/anchor)
//      rather than picked arbitrarily, so a user pays actual cost plus a small protocol cut.
//   2. Value-based pricing for tasks on valuable assets (trees, fruit, livestock): an extra
//      component scaled by the declared value, with a FLOOR so under-declaring does not pay.
//   3. Demand-elastic pricing (demand_factor) — a small increase under load, to shed it.
//   4. A hard CAP: fee ≤ MAX_FRACTION × the traditional cost, so it is always the cheaper option.
//
// Every constant here is a simulated PLACEHOLDER (fixed for the medium term). Long term the DAO
// votes them through the dao_set_* functions; in production LAMP/USD comes from the Score DEX
// oracle (TWAP), which is not wired yet.

/** 1 LAMP = 10^6 oil (the smallest on-chain unit). Mirrors LAMP/protocol-utils OIL_PER_LAMP. */
export const OIL_PER_LAMP = 1_000_000n;

/** Default conversion rate: 1 LAMP = 0.01 USD. In production: an oracle TWAP. */
export const LAMP_USD_DEFAULT = 0.01;
/** Valid bounds for the LAMP/USD rate (stops a DAO or oracle value that would break the system — M-1). */
export const LAMP_USD_MIN = 1e-6;
export const LAMP_USD_MAX = 1e6;

/** ABSOLUTE per-task cap in USD — a backstop independent of traditionalCost (M-2).
 *  The primary cap is MAX_FRACTION × traditionalCost; this one stops an inflated traditionalCost. */
export const MAX_FEE_USD_ABSOLUTE = 100;

/** Fee floor in oil for any task with a real cost — stops feeOil rounding to zero (L-2). */
export const MIN_FEE_OIL = 1_000n; // 0.001 LAMP

/** Protocol cut in basis points — goes to the PROTOCOL bucket. 700 = 7%. */
export const PROTOCOL_CUT_BPS = 700n;

/** How the REMAINDER (after the protocol cut) splits across the four resources (bps, sums to 10000).
 *  storage/compute/bandwidth go to the LAMPNET_REWARD bucket; anchor goes to the ANCHOR bucket. */
export const RESOURCE_SPLIT_BPS = {
  storage: 4000n,
  compute: 3500n,
  bandwidth: 1500n,
  anchor: 1000n,
} as const;

/** On-chain anchoring tier → whole-fee multiplier (a stronger immutability promise costs more). */
export type AnchorTier = "no_anchor" | "batch_daily" | "milestone" | "immediate";
export const ANCHOR_TIER_MULT: Record<AnchorTier, number> = {
  no_anchor: 0.3,
  batch_daily: 1.0,
  milestone: 1.8,
  immediate: 6.0,
};

/** Fee cap = MAX_FRACTION × traditional cost (guarantees at least 50% cheaper). */
export const MAX_FRACTION_OF_TRADITIONAL = 0.5;

/** Bounds on demand_factor (demand elasticity). */
export const DEMAND_FACTOR_MIN = 0.5;
export const DEMAND_FACTOR_MAX = 3.0;
/** Cap on the change per EMA step (±10%) — absorbs price shocks. */
export const DEMAND_STEP_CAP = 0.1;
/** Sensitivity of the (ratio − 1) → delta mapping. */
export const DEMAND_SENSITIVITY = 0.5;

// ── Adjustable LAMP/USD rate (DAO or oracle) ────────────────────────────────
let lampUsd = LAMP_USD_DEFAULT;
export function getLampUsd(): number {
  return lampUsd;
}
/** DAO/oracle updates the LAMP/USD rate. Clamped to [LAMP_USD_MIN, LAMP_USD_MAX] (M-1). */
export function daoSetLampUsd(v: number): void {
  if (!Number.isFinite(v) || v <= 0) throw new Error("PARAM-001: lampUsd must be finite and > 0");
  if (v < LAMP_USD_MIN || v > LAMP_USD_MAX) {
    throw new Error(`PARAM-002: lampUsd=${v} is outside [${LAMP_USD_MIN}, ${LAMP_USD_MAX}].`);
  }
  lampUsd = v;
}

/** Check the four resource shares sum to exactly 10000 bps (M-3) — run at load and on any DAO change. */
export function assertResourceSplitSound(): void {
  const sum = RESOURCE_SPLIT_BPS.storage + RESOURCE_SPLIT_BPS.compute
    + RESOURCE_SPLIT_BPS.bandwidth + RESOURCE_SPLIT_BPS.anchor;
  if (sum !== 10_000n) {
    throw new Error(
      `PARAM-003: RESOURCE_SPLIT_BPS sums to ${sum}, not 10000 — anchor takes the remainder, `
      + `so its share would silently drift.`);
  }
}
assertResourceSplitSound();
