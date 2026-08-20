// OriLife Fee — Collect e2e trên Preview testnet THẬT (Blockfrost, ví thật, LAMP thật).
// Đây là bằng chứng on-chain: phí OriLife (LAMP) nạp về 3 bucket treasury.
//
// Chạy: npx tsx scripts/02_collect_preview.ts [tác_vụ] [giá_trị_USD]
// Ví dụ: npx tsx scripts/02_collect_preview.ts animal.enroll 1000

import { Data } from "@lucid-evolution/lucid";
import {
  NETWORK, LAMP_POLICY_ID, LAMP_ASSET_NAME, LAMP_UNIT,
  makeLucid, custodyValidator,
  explorerTx, awaitTx, loadDeployed,
} from "./config_preview.js";
import { decodeCustodyDatum } from "../vendor/lamp/Treasury/offchain/src/datum.js";
import { ledgerGet } from "../vendor/lamp/Treasury/offchain/src/collect.js";
import { buildFeeCollectTx } from "../src/treasuryClient.js";
import { quoteFee } from "../src/feeEngine.js";
import { utf8ToHex, type BridgeConfig } from "../src/bridge.js";

const task = process.argv[2] ?? "animal.enroll";
const declaredValue = parseFloat(process.argv[3] ?? "1000");

async function main(): Promise<void> {
  console.log(`=== OriLife Fee — Collect Preview (${task}, value=$${declaredValue}) ===\n`);

  const lucid = await makeLucid();
  const state = loadDeployed();
  const script = custodyValidator();
  const addr = await lucid.wallet().address();
  console.log("Wallet   :", addr);
  console.log("Custody  :", state.custody.address, "\n");

  // Lấy custody UTxO (dùng txHash từ genesis để xác định đúng).
  const custodyUtxos = await lucid.utxosAt(state.custody.address);
  const custodyUtxo = custodyUtxos.find((u) => u.datum);
  if (!custodyUtxo) throw new Error("Không tìm thấy custody UTxO — đã deploy custody chưa?");

  // Đọc datum trước.
  const datumBefore = decodeCustodyDatum(Data.from(custodyUtxo.datum!));
  const heldBefore = custodyUtxo.assets[LAMP_UNIT] ?? 0n;
  console.log("── Trước Collect ──");
  console.log(`custody LAMP: ${heldBefore} oil`);
  console.log(`sổ bucket 0 (PROTOCOL):        ${ledgerGet(datumBefore.ledger, 0n, LAMP_POLICY_ID, LAMP_ASSET_NAME)}`);
  console.log(`sổ bucket 1 (LAMPNET_REWARD):  ${ledgerGet(datumBefore.ledger, 1n, LAMP_POLICY_ID, LAMP_ASSET_NAME)}`);
  console.log(`sổ bucket 2 (ANCHOR):          ${ledgerGet(datumBefore.ledger, 2n, LAMP_POLICY_ID, LAMP_ASSET_NAME)}`);
  console.log();

  // Định giá.
  const quote = quoteFee({ task, declaredValueUsd: declaredValue, lifecycleEvents: 4 });
  console.log("── FeeQuote ──");
  console.log(`tác vụ:   ${quote.task}  anchortier=${quote.anchorTier}`);
  console.log(`phí USD:  $${quote.feeUsd}  (rẻ hơn ${quote.advantagePct}% truyền thống, capped=${quote.capped})`);
  console.log(`phí LAMP: ${quote.feeLamp} = ${quote.feeOil} oil`);
  for (const b of quote.buckets) {
    console.log(`  bucket ${b.category} ${b.bucket}: ${b.oil} oil`);
  }
  console.log();

  // Xem ví có đủ LAMP không.
  const walletUtxos = await lucid.wallet().getUtxos();
  let walletLamp = 0n;
  for (const u of walletUtxos) walletLamp += u.assets[LAMP_UNIT] ?? 0n;
  console.log(`Ví có LAMP: ${walletLamp} oil (= ${Number(walletLamp)/1e6} LAMP)`);
  if (walletLamp < quote.feeOil) {
    throw new Error(`LAMP không đủ: cần ${quote.feeOil} oil, có ${walletLamp} oil.`);
  }
  console.log();

  // Dựng + submit Collect tx.
  const cfg: BridgeConfig = {
    appIdHex: utf8ToHex("orilife"),
    lampPolicyHex: LAMP_POLICY_ID,
    lampNameHex: LAMP_ASSET_NAME,
  };
  const { tx, items, cutValue, summary } = await buildFeeCollectTx({
    lucid, network: NETWORK, custodyUtxo, custodyScript: script, quote, cfg,
  });
  console.log(summary);
  console.log(`items: ${items.length}`);
  console.log();

  const cutLamp = cutValue[`${LAMP_POLICY_ID.toLowerCase()}|${LAMP_ASSET_NAME.toLowerCase()}`] ?? 0n;

  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();
  console.log("TX       :", txHash);
  console.log("Explorer :", explorerTx(txHash));
  await awaitTx(lucid, txHash, "collect");

  // Đọc sau.
  const custodyUtxos2 = await lucid.utxosAt(state.custody.address);
  const utxo2 = custodyUtxos2.find((u) => u.txHash === txHash && u.datum)
    ?? custodyUtxos2.find((u) => u.datum);
  if (!utxo2) throw new Error("Không tìm thấy custody UTxO sau collect.");

  const datumAfter = decodeCustodyDatum(Data.from(utxo2.datum!));
  const heldAfter = utxo2.assets[LAMP_UNIT] ?? 0n;

  console.log("\n── Sau Collect ──");
  console.log(`custody LAMP: ${heldAfter} oil  (Δ +${heldAfter - heldBefore})`);
  console.log(`sổ bucket 0 (PROTOCOL):        ${ledgerGet(datumAfter.ledger, 0n, LAMP_POLICY_ID, LAMP_ASSET_NAME)}`);
  console.log(`sổ bucket 1 (LAMPNET_REWARD):  ${ledgerGet(datumAfter.ledger, 1n, LAMP_POLICY_ID, LAMP_ASSET_NAME)}`);
  console.log(`sổ bucket 2 (ANCHOR):          ${ledgerGet(datumAfter.ledger, 2n, LAMP_POLICY_ID, LAMP_ASSET_NAME)}`);

  const ok = (c: boolean) => c ? "✅" : "❌";
  console.log("\n── Bất biến ──");
  const p = ledgerGet(datumAfter.ledger, 0n, LAMP_POLICY_ID, LAMP_ASSET_NAME);
  const l = ledgerGet(datumAfter.ledger, 1n, LAMP_POLICY_ID, LAMP_ASSET_NAME);
  const a = ledgerGet(datumAfter.ledger, 2n, LAMP_POLICY_ID, LAMP_ASSET_NAME);
  const bk0 = quote.buckets.find((b) => b.category === 0n)!.oil;
  const bk1 = quote.buckets.find((b) => b.category === 1n)!.oil;
  const bk2 = quote.buckets.find((b) => b.category === 2n)!.oil;
  console.log(`${ok((heldAfter - heldBefore) === cutLamp)}  LAMP value tăng == cut`);
  console.log(`${ok(p === bk0)}  sổ PROTOCOL == ${bk0}`);
  console.log(`${ok(l === bk1)}  sổ LAMPNET_REWARD == ${bk1}`);
  console.log(`${ok(a === bk2)}  sổ ANCHOR == ${bk2}`);
  console.log(`${ok(p + l + a === quote.feeOil)}  Σ sổ 3 bucket == feeOil (${quote.feeOil})`);
  console.log(`${ok(datumAfter.cut_bps === 10_000n)}  cut_bps bảo toàn = 10000`);

  const allOk = (heldAfter - heldBefore) === cutLamp && p===bk0 && l===bk1 && a===bk2
    && p+l+a===quote.feeOil && datumAfter.cut_bps===10_000n;

  if (!allOk) throw new Error("COLLECT-PREVIEW-001: bất biến bị vi phạm (xem ❌ trên).");

  console.log("\n✅✅ COLLECT PREVIEW PASS — phí OriLife (LAMP thật) đã nạp về 3 bucket treasury");
  console.log("   LAMP fixed-supply: chuyển circulating → accounting, KHÔNG đốt.");
  console.log(`   txHash: ${txHash}`);
  console.log(`   Explorer: ${explorerTx(txHash)}`);
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.stack ?? e.message : e); process.exit(1); });
