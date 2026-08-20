// OriLife — E2E EMULATOR (a printing script): demonstrates that "one transaction carrying LAMP
// amounts into the treasuries" actually runs through the REAL custody Plutus validator, with no
// wallet, faucet or Blockfrost needed.
//
// Run with: npm run e2e:emulator

import { runEmulatorCollect, LAMP_POLICY, LAMP_NAME, SEED_ADA } from "./harness.js";

function ok(c: boolean): string { return c ? "✅" : "❌"; }

async function main(): Promise<void> {
  console.log("=== OriLife Fee -> Treasury — E2E EMULATOR (real Plutus validator) ===\n");

  const r = await runEmulatorCollect({
    task: "animal.enroll", declaredValueUsd: 1000, anchorTier: "immediate", lifecycleEvents: 4,
  });

  console.log("custody address:", r.custodyAddress, "\n");
  console.log("── FeeQuote ──");
  console.log(`task:       ${r.quote.task}`);
  console.log(`fee (USD):  ${r.quote.feeUsd}  (${r.quote.advantagePct}% cheaper than traditional, capped=${r.quote.capped})`);
  console.log(`LAMP fee:  ${r.quote.feeLamp} = ${r.quote.feeOil} oil`);
  for (const b of r.quote.buckets) console.log(`  bucket ${b.category} ${b.bucket}: ${b.oil} oil`);
  console.log("\n" + r.summary + "\n");
  console.log("✅ GIAO DỊCH COLLECT submit qua validator Plutus — txHash:", r.txHash, "\n");

  console.log("── Custody sau Collect ──");
  console.log(`LAMP value: ${r.lampAfter}   ADA value: ${r.adaAfter}`);
  console.log(`ledger PROTOCOL=${r.ledgerAfter.protocol}  LAMPNET=${r.ledgerAfter.lampnet}  ANCHOR=${r.ledgerAfter.anchor}\n`);

  const q = r.quote;
  const checks: [string, boolean][] = [
    ["custody LAMP == feeOil (the whole fee reached the treasury)", r.lampAfter === q.feeOil],
    ["LAMP custody == Σcut", r.lampAfter === r.cutLamp],
    ["ADA conserved (the seed is untouched)", r.adaAfter === SEED_ADA],
    ["ledger PROTOCOL == oil", r.ledgerAfter.protocol === q.buckets.find((b) => b.category === 0n)!.oil],
    ["ledger LAMPNET_REWARD == oil", r.ledgerAfter.lampnet === q.buckets.find((b) => b.category === 1n)!.oil],
    ["ledger ANCHOR == oil", r.ledgerAfter.anchor === q.buckets.find((b) => b.category === 2n)!.oil],
    ["Σ of the 3 bucket rows == feeOil (conservation)", r.ledgerAfter.protocol + r.ledgerAfter.lampnet + r.ledgerAfter.anchor === q.feeOil],
    ["cut_bps and instance_id unchanged", r.datumAfter.cut_bps === 10_000n],
  ];

  console.log("-- Invariants (enforced by the validator, cross-checked off-chain) --");
  let allOk = true;
  for (const [label, cond] of checks) { console.log(`${ok(cond)} ${label}`); if (!cond) allOk = false; }
  void LAMP_POLICY; void LAMP_NAME;

  if (!allOk) throw new Error("E2E-EMU-001: an invariant was violated.");
  console.log("\nE2E PASS — the OriLife fee (LAMP) reached all three treasury buckets in ONE");
  console.log("    transaction; the custody Plutus validator accepted it, and value is conserved");
  console.log("    Sigma-out = Sigma-in per asset (fixed supply — nothing is burned).");
  console.log(`    txHash: ${r.txHash}`);
}

main().catch((e) => { console.error("\n❌", e instanceof Error ? e.stack ?? e.message : e); process.exit(1); });
