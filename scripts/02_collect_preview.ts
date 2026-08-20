// OriLife Fee — an end-to-end Collect on the REAL Preview testnet (Blockfrost, a real wallet,
// real LAMP). This is the on-chain evidence: an OriLife fee in LAMP landing in three treasury
// buckets.
//
// Run:      npx tsx scripts/02_collect_preview.ts [task] [declared_value_usd]
// Example:  npx tsx scripts/02_collect_preview.ts animal.enroll 1000
//
// Two things this script gets right, and that are easy to get wrong:
//
//   1. It selects the custody UTxO by INSTANCE_ID, not by "the first one with a datum". Several
//      custody instances live at the same script address, and picking the wrong one routes the fee
//      into somebody else's ledger.
//   2. The ledger in the datum is CUMULATIVE, while a quote describes ONE collect. So the checks
//      below compare DELTAS (after − before), never absolutes. Comparing absolutes passes exactly
//      once, on a virgin instance, and raises a false alarm on every run after that — after the
//      money has already moved.

import { Data } from "@lucid-evolution/lucid";
import {
  NETWORK, LAMP_POLICY_ID, LAMP_ASSET_NAME, LAMP_UNIT, INSTANCE_ID,
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

  // Select the custody UTxO by instance_id. Several instances share this script address, so
  // "the first UTxO that has a datum" is not the same thing as "our instance".
  const wantInstance = utf8ToHex(INSTANCE_ID).toLowerCase();
  const custodyUtxos = await lucid.utxosAt(state.custody.address);
  const matching = custodyUtxos.filter((u) => {
    if (!u.datum) return false;
    try {
      return decodeCustodyDatum(Data.from(u.datum)).instance_id.toLowerCase() === wantInstance;
    } catch {
      return false; // a datum of some other shape belongs to some other instance
    }
  });
  if (matching.length === 0) {
    throw new Error(
      `No custody UTxO for instance '${INSTANCE_ID}' at ${state.custody.address}. `
      + `Found ${custodyUtxos.length} UTxO(s) there, none of them ours — has custody been deployed?`);
  }
  if (matching.length > 1) {
    throw new Error(
      `Found ${matching.length} UTxOs for instance '${INSTANCE_ID}' — expected exactly one. `
      + `Spending the wrong one splits the ledger; resolve this by hand before continuing.`);
  }
  const custodyUtxo = matching[0]!;

  // Read the datum before the collect.
  const datumBefore = decodeCustodyDatum(Data.from(custodyUtxo.datum!));
  const heldBefore = custodyUtxo.assets[LAMP_UNIT] ?? 0n;
  const before = {
    p: ledgerGet(datumBefore.ledger, 0n, LAMP_POLICY_ID, LAMP_ASSET_NAME),
    l: ledgerGet(datumBefore.ledger, 1n, LAMP_POLICY_ID, LAMP_ASSET_NAME),
    a: ledgerGet(datumBefore.ledger, 2n, LAMP_POLICY_ID, LAMP_ASSET_NAME),
  };
  console.log("-- Before the collect --");
  console.log(`custody LAMP: ${heldBefore} oil`);
  console.log(`ledger bucket 0 (PROTOCOL):        ${before.p}`);
  console.log(`ledger bucket 1 (LAMPNET_REWARD):  ${before.l}`);
  console.log(`ledger bucket 2 (ANCHOR):          ${before.a}`);
  console.log();

  // Price the task.
  const quote = quoteFee({ task, declaredValueUsd: declaredValue, lifecycleEvents: 4 });
  console.log("-- FeeQuote --");
  console.log(`task:       ${quote.task}  anchorTier=${quote.anchorTier}`);
  console.log(`fee (USD):  $${quote.feeUsd}  (${quote.advantagePct}% cheaper than traditional, capped=${quote.capped})`);
  console.log(`fee (LAMP): ${quote.feeLamp} = ${quote.feeOil} oil`);
  for (const b of quote.buckets) {
    console.log(`  bucket ${b.category} ${b.bucket}: ${b.oil} oil`);
  }
  console.log();

  // Check the wallet holds enough LAMP.
  const walletUtxos = await lucid.wallet().getUtxos();
  let walletLamp = 0n;
  for (const u of walletUtxos) walletLamp += u.assets[LAMP_UNIT] ?? 0n;
  console.log(`Wallet LAMP: ${walletLamp} oil (= ${Number(walletLamp) / 1e6} LAMP)`);
  if (walletLamp < quote.feeOil) {
    throw new Error(`Not enough LAMP: need ${quote.feeOil} oil, have ${walletLamp} oil.`);
  }
  console.log();

  // Build and submit the Collect transaction.
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

  // Everything checkable BEFORE spending a network fee is checked here. What remains after this
  // point can only be observed once the transaction has settled.
  if (cutLamp !== quote.feeOil) {
    throw new Error(
      `COLLECT-PREVIEW-000: the builder's cut (${cutLamp}) does not equal the quoted feeOil `
      + `(${quote.feeOil}). Nothing has been submitted.`);
  }

  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();
  console.log("TX       :", txHash);
  console.log("Explorer :", explorerTx(txHash));
  await awaitTx(lucid, txHash, "collect");

  // Read the state back after settlement.
  const custodyUtxos2 = await lucid.utxosAt(state.custody.address);
  const utxo2 = custodyUtxos2.find((u) => u.txHash === txHash && u.datum)
    ?? custodyUtxos2.find((u) => u.datum);
  if (!utxo2) throw new Error("custody UTxO not found after the collect.");

  const datumAfter = decodeCustodyDatum(Data.from(utxo2.datum!));
  const heldAfter = utxo2.assets[LAMP_UNIT] ?? 0n;

  const after = {
    p: ledgerGet(datumAfter.ledger, 0n, LAMP_POLICY_ID, LAMP_ASSET_NAME),
    l: ledgerGet(datumAfter.ledger, 1n, LAMP_POLICY_ID, LAMP_ASSET_NAME),
    a: ledgerGet(datumAfter.ledger, 2n, LAMP_POLICY_ID, LAMP_ASSET_NAME),
  };

  console.log("\n-- After the collect --");
  console.log(`custody LAMP: ${heldAfter} oil  (delta +${heldAfter - heldBefore})`);
  console.log(`ledger bucket 0 (PROTOCOL):        ${after.p}  (delta +${after.p - before.p})`);
  console.log(`ledger bucket 1 (LAMPNET_REWARD):  ${after.l}  (delta +${after.l - before.l})`);
  console.log(`ledger bucket 2 (ANCHOR):          ${after.a}  (delta +${after.a - before.a})`);

  const ok = (c: boolean) => (c ? "OK  " : "FAIL");
  console.log("\n-- Reconciliation (the transaction has already settled) --");
  const bk0 = quote.buckets.find((b) => b.category === 0n)!.oil;
  const bk1 = quote.buckets.find((b) => b.category === 1n)!.oil;
  const bk2 = quote.buckets.find((b) => b.category === 2n)!.oil;
  const dLamp = heldAfter - heldBefore;
  const dP = after.p - before.p, dL = after.l - before.l, dA = after.a - before.a;
  console.log(`${ok(dLamp === cutLamp)}  LAMP value increased by the cut (${cutLamp})`);
  console.log(`${ok(dP === bk0)}  PROTOCOL row rose by ${bk0}`);
  console.log(`${ok(dL === bk1)}  LAMPNET_REWARD row rose by ${bk1}`);
  console.log(`${ok(dA === bk2)}  ANCHOR row rose by ${bk2}`);
  console.log(`${ok(dP + dL + dA === quote.feeOil)}  the three deltas sum to feeOil (${quote.feeOil})`);
  console.log(`${ok(datumAfter.cut_bps === 10_000n)}  cut_bps unchanged at 10000`);

  const allOk = dLamp === cutLamp && dP === bk0 && dL === bk1 && dA === bk2
    && dP + dL + dA === quote.feeOil && datumAfter.cut_bps === 10_000n;

  if (!allOk) {
    throw new Error(
      "COLLECT-PREVIEW-001: the post-settlement reconciliation does not match (see FAIL above). "
      + `The transaction ${txHash} HAS ALREADY SETTLED — do not re-run this script to "retry", `
      + "that would submit a second real transaction. Investigate the mismatch first.");
  }

  console.log("\nCOLLECT PREVIEW PASS — a real OriLife fee in LAMP reached all three treasury buckets.");
  console.log("   LAMP is fixed-supply: this moves it from circulating to accounting, never burns it.");
  console.log(`   txHash: ${txHash}`);
  console.log(`   Explorer: ${explorerTx(txHash)}`);
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.stack ?? e.message : e); process.exit(1); });
