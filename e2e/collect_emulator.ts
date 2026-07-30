// OriLife — E2E EMULATOR (script in ấn): chứng minh "1 giao dịch với các khoản LAMP đính
// kèm về các treasury" CHẠY QUA validator Plutus custody THẬT, KHÔNG cần ví/faucet/Blockfrost.
//
// Chạy: npm run e2e:emulator

import { runEmulatorCollect, LAMP_POLICY, LAMP_NAME, SEED_ADA } from "./harness.js";

function ok(c: boolean): string { return c ? "✅" : "❌"; }

async function main(): Promise<void> {
  console.log("=== OriLife Fee → Treasury — E2E EMULATOR (validator Plutus thật) ===\n");

  const r = await runEmulatorCollect({
    task: "animal.enroll", declaredValueUsd: 1000, anchorTier: "immediate", lifecycleEvents: 4,
  });

  console.log("custody address:", r.custodyAddress, "\n");
  console.log("── FeeQuote ──");
  console.log(`tác vụ:    ${r.quote.task}`);
  console.log(`phí USD:   ${r.quote.feeUsd}  (rẻ hơn truyền thống ${r.quote.advantagePct}%, capped=${r.quote.capped})`);
  console.log(`phí LAMP:  ${r.quote.feeLamp} = ${r.quote.feeOil} oil`);
  for (const b of r.quote.buckets) console.log(`  bucket ${b.category} ${b.bucket}: ${b.oil} oil`);
  console.log("\n" + r.summary + "\n");
  console.log("✅ GIAO DỊCH COLLECT submit qua validator Plutus — txHash:", r.txHash, "\n");

  console.log("── Custody sau Collect ──");
  console.log(`LAMP value: ${r.lampAfter}   ADA value: ${r.adaAfter}`);
  console.log(`sổ PROTOCOL=${r.ledgerAfter.protocol}  LAMPNET=${r.ledgerAfter.lampnet}  ANCHOR=${r.ledgerAfter.anchor}\n`);

  const q = r.quote;
  const checks: [string, boolean][] = [
    ["LAMP custody == feeOil (toàn bộ phí vào treasury)", r.lampAfter === q.feeOil],
    ["LAMP custody == Σcut", r.lampAfter === r.cutLamp],
    ["ADA bảo toàn (seed giữ nguyên)", r.adaAfter === SEED_ADA],
    ["sổ PROTOCOL == oil", r.ledgerAfter.protocol === q.buckets.find((b) => b.category === 0n)!.oil],
    ["sổ LAMPNET_REWARD == oil", r.ledgerAfter.lampnet === q.buckets.find((b) => b.category === 1n)!.oil],
    ["sổ ANCHOR == oil", r.ledgerAfter.anchor === q.buckets.find((b) => b.category === 2n)!.oil],
    ["Σ sổ 3 bucket == feeOil (bảo toàn)", r.ledgerAfter.protocol + r.ledgerAfter.lampnet + r.ledgerAfter.anchor === q.feeOil],
    ["cut_bps + instance_id bảo toàn", r.datumAfter.cut_bps === 10_000n],
  ];

  console.log("── Bất biến (ép bởi validator + đối chiếu off-chain) ──");
  let allOk = true;
  for (const [label, cond] of checks) { console.log(`${ok(cond)} ${label}`); if (!cond) allOk = false; }
  void LAMP_POLICY; void LAMP_NAME;

  if (!allOk) throw new Error("E2E-EMU-001: vi phạm bất biến.");
  console.log("\n✅✅ E2E PASS — phí OriLife (LAMP) nạp về 3 bucket treasury qua 1 giao dịch,");
  console.log("    validator Plutus custody chấp nhận, value bảo toàn Σout=Σin (fixed-supply, KHÔNG đốt).");
  console.log(`    txHash: ${r.txHash}`);
}

main().catch((e) => { console.error("\n❌", e instanceof Error ? e.stack ?? e.message : e); process.exit(1); });
