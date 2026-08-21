// OriLife — the BRIDGE from a fee to a Treasury Collect. This is the INTERFACE CONTRACT between
// OriLife's off-chain pricing core and the on-chain LAMP Treasury custody layer. The orchestrator
// owns this piece.
//
// Design decisions, recorded so they are traceable rather than re-litigated:
//   • Long-term direction: OriLife is the FIRST integrator to deposit real fees into the treasury,
//     which demonstrates the LAMP value loop to every Cardano team.
//   • From first principles: the Collect builder keeps `cut = floor(amount × cut_bps/10000)` in the
//     bucket and returns `amount − cut` as residual to a provider. An OriLife fee is a REAL fee
//     (no provider gets anything back), so the OriLife instance sets cut_bps = 10000 (100%),
//     making cut == amount: the whole fee lands in the treasury and residual is 0. Each bucket is
//     one CollectItem.category.
//   • eUTXO efficiency: all three buckets go into ONE Collect transaction (several items, one
//     custody input and output) — one UTxO, one network fee. This is the "micro-collect"
//     anti-bloat approach the Treasury layer is built around.
//   • User benefit and sustainability: Σ items == fee_oil exactly (conservation; fixed supply;
//     nothing burned). The LampNet node share stays in the LAMPNET_REWARD bucket and is redeemed
//     later through Release.

import type { FeeQuote } from "./feeEngine.js";

/** A byte-for-byte mirror of LAMP/Treasury/offchain/src/types.ts CollectItem (the interface
 *  contract). Kept locally so the bridge core is testable WITHOUT the LAMP repository;
 *  treasuryClient.ts imports the REAL Treasury SDK type and checks structural compatibility
 *  when it builds the transaction. */
export interface CollectItem {
  app_id: string;   // hex — who is paying (OriLife)
  policy: string;   // hex — the asset (LAMP policy)
  name: string;     // hex — the asset name (LAMP)
  amount: bigint;   // oil, as priced by the app
  category: bigint; // destination bucket_id for the cut
}

/** The cut_bps the OriLife custody instance MUST use (100% — a real fee, no residual). */
export const ORILIFE_CUT_BPS = 10_000n;

export interface BridgeConfig {
  /** app_id (hex) written into the receipt — identifies OriLife. */
  appIdHex: string;
  /** LAMP policy id (hex). */
  lampPolicyHex: string;
  /** LAMP asset name (hex) — usually "4c414d50". */
  lampNameHex: string;
}

/** Encode a UTF-8 string to hex (for the app_id "orilife"). Hand-rolled, so no DOM dependency. */
export function utf8ToHex(s: string): string {
  let hex = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const bytes: number[] =
      cp < 0x80 ? [cp]
      : cp < 0x800 ? [0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)]
      : cp < 0x10000 ? [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)]
      : [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)];
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * FeeQuote → CollectItem[]. Every bucket with oil > 0 becomes one item (category = bucket).
 * Buckets with oil == 0 are skipped, so no empty ledger rows are created. amount = oil,
 * because cut_bps = 10000 makes cut = oil.
 */
export function quoteToCollectItems(quote: FeeQuote, cfg: BridgeConfig): CollectItem[] {
  return quote.buckets
    .filter((b) => b.oil > 0n)
    .map((b) => ({
      app_id: cfg.appIdHex,
      policy: cfg.lampPolicyHex,
      name: cfg.lampNameHex,
      amount: b.oil,
      category: b.category,
    }));
}

/** Total oil across a batch of items (must equal quote.feeOil when cut_bps = 10000). */
export function totalItemOil(items: CollectItem[]): bigint {
  return items.reduce((acc, it) => acc + it.amount, 0n);
}

/**
 * Check the bridge invariants BEFORE building a transaction (fail fast, before spending a
 * network fee):
 *   • the custody instance must have cut_bps == 10000 (pure deposit) — anything else changes
 *     the semantics;
 *   • Σ item.amount == quote.feeOil (no oil lost or invented — matches on-chain conservation);
 *   • every amount is >= 0.
 * Throws with a specific message on any violation.
 */
export function assertBridgeInvariants(
  quote: FeeQuote, items: CollectItem[], custodyCutBps: bigint,
): void {
  if (custodyCutBps !== ORILIFE_CUT_BPS) {
    throw new Error(
      `BRIDGE-001: the OriLife instance must use cut_bps=${ORILIFE_CUT_BPS} (100%, pure deposit), `
        + `got ${custodyCutBps}. Any other cut_bps makes cut != amount, so the fee does not fully `
        + `reach the treasury.`,
    );
  }
  const sum = totalItemOil(items);
  if (sum !== quote.feeOil) {
    throw new Error(
      `BRIDGE-002: Σ items (${sum}) != feeOil (${quote.feeOil}) — conservation violated.`);
  }
  if (items.some((it) => it.amount < 0n)) {
    throw new Error("BRIDGE-003: an item has amount < 0.");
  }
}
