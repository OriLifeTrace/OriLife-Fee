// INTEGRATION test: runs one Collect transaction (an OriLife fee into the three treasury buckets)
// through the REAL custody Plutus validator inside the Lucid Emulator. This is the evidence that
// re-runs automatically on every `npm test`.
//
// Requires vendor/treasury-custody.plutus.json. That blueprint already sits in vendor/ and must
// NOT be rebuilt: rebuilding changes the script hash, which changes the custody address that
// already holds real assets. The test fails with a clear message if the file is missing.

import { describe, it, expect } from "vitest";
import { runEmulatorCollect, runEmulatorMultiCollect, SEED_ADA } from "../e2e/harness.js";

describe("E2E emulator — an OriLife fee deposits LAMP into treasury buckets via the Plutus validator", () => {
  it("animal.enroll: one Collect through the real validator, value and ledger both conserved", async () => {
    const r = await runEmulatorCollect({
      task: "animal.enroll", declaredValueUsd: 1000, anchorTier: "immediate", lifecycleEvents: 4,
    });

    // The transaction was submitted and confirmed — the validator accepted it.
    expect(r.txHash).toMatch(/^[0-9a-f]{64}$/);

    // The whole fee (LAMP oil) is now in custody (cut_bps=10000 means cut == feeOil).
    expect(r.lampAfter).toBe(r.quote.feeOil);
    expect(r.lampAfter).toBe(r.cutLamp);

    // The seed ADA is untouched — nothing drained.
    expect(r.adaAfter).toBe(SEED_ADA);

    // Each bucket's ledger row matches the quoted oil.
    const get = (cat: bigint) => r.quote.buckets.find((b) => b.category === cat)!.oil;
    expect(r.ledgerAfter.protocol).toBe(get(0n));
    expect(r.ledgerAfter.lampnet).toBe(get(1n));
    expect(r.ledgerAfter.anchor).toBe(get(2n));

    // Exact conservation: Σ ledger == feeOil.
    expect(r.ledgerAfter.protocol + r.ledgerAfter.lampnet + r.ledgerAfter.anchor).toBe(r.quote.feeOil);

    // The instance parameters are unchanged.
    expect(r.datumAfter.cut_bps).toBe(10_000n);
  }, 60_000);

  it("tree.register (batch_daily): deposits correctly and conserves too", async () => {
    const r = await runEmulatorCollect({ task: "tree.register", declaredValueUsd: 500, lifecycleEvents: 2 });
    expect(r.txHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.lampAfter).toBe(r.quote.feeOil);
    expect(r.ledgerAfter.protocol + r.ledgerAfter.lampnet + r.ledgerAfter.anchor).toBe(r.quote.feeOil);
  }, 60_000);

  // B2: two Collects in a row on the SAME custody, which exercises the incremental ledger branch
  // (adding to an existing row) through the real Plutus validator. The tests above only cover the
  // "create a new row" branch.
  it("multi-collect: ledger and value accumulate correctly across two transactions", async () => {
    const q1 = { task: "animal.enroll", declaredValueUsd: 1000, anchorTier: "immediate" as const };
    const q2 = { task: "tree.register", declaredValueUsd: 500, lifecycleEvents: 2 };
    const rs = await runEmulatorMultiCollect([q1, q2]);
    expect(rs).toHaveLength(2);
    const r1 = rs[0]!, r2 = rs[1]!;

    expect(r1.txHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r2.txHash).toMatch(/^[0-9a-f]{64}$/);

    // After the second collect: custody LAMP == feeOil1 + feeOil2.
    expect(r2.lampAfter).toBe(r1.quote.feeOil + r2.quote.feeOil);

    // Each bucket's ledger row == its oil from the first plus the second collect.
    const b = (q: typeof r1.quote, c: bigint) => q.buckets.find((x) => x.category === c)!.oil;
    expect(r2.ledgerAfter.protocol).toBe(b(r1.quote, 0n) + b(r2.quote, 0n));
    expect(r2.ledgerAfter.lampnet).toBe(b(r1.quote, 1n) + b(r2.quote, 1n));
    expect(r2.ledgerAfter.anchor).toBe(b(r1.quote, 2n) + b(r2.quote, 2n));

    // Total conservation.
    expect(r2.ledgerAfter.protocol + r2.ledgerAfter.lampnet + r2.ledgerAfter.anchor)
      .toBe(r1.quote.feeOil + r2.quote.feeOil);
  }, 90_000);
});
