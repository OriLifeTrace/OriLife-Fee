// OriLife Fee — Deploy custody instance trên Preview testnet.
// Instance đặc biệt: cut_bps=10000 (pure-deposit) + instance_id="orilife-fee-v1".
// Accepted asset: LAMP từ LAMP/.env LAMP_POLICY_ID.
//
// Chạy: npx tsx scripts/01_deploy_custody_preview.ts

import { Data } from "@lucid-evolution/lucid";
import {
  NETWORK, LAMP_POLICY_ID, LAMP_ASSET_NAME,
  makeLucid, custodyValidator, custodyAddress,
  explorerTx, awaitTx, saveDeployed,
} from "./config_preview.js";
import { custodyDatumToCbor } from "../vendor/lamp/Treasury/offchain/src/datum.js";
import { seedDatumOk } from "../vendor/lamp/Treasury/offchain/src/collect.js";
import { assetsToMap } from "../vendor/lamp/Treasury/offchain/src/collectBuilder.js";
import { utf8ToHex } from "../src/bridge.js";
import type { CustodyDatum } from "../vendor/lamp/Treasury/offchain/src/types.js";

const SEED_LOVELACE = 5_000_000n; // 5 ADA min-UTxO

async function main(): Promise<void> {
  console.log("=== OriLife Fee — Deploy custody instance (Preview testnet) ===\n");
  console.log("Network  :", NETWORK);
  console.log("LAMP     :", LAMP_POLICY_ID.slice(0, 12) + "…/" + LAMP_ASSET_NAME, "\n");

  const lucid = await makeLucid();
  const addr = await lucid.wallet().address();
  console.log("Wallet   :", addr, "\n");

  // Custody validator + address.
  const script = custodyValidator();
  const custAddr = custodyAddress(script);
  console.log("Custody address :", custAddr);

  // Seed datum: cut_bps=10000, sổ rỗng, LAMP là asset được nhận.
  const seedDatum: CustodyDatum = {
    instance_id:      utf8ToHex("orilife-fee-v1"),
    accepted_assets:  [{ policy: LAMP_POLICY_ID, name: LAMP_ASSET_NAME }],
    ledger:           [],
    cut_bps:          10_000n,
    governance_ref:   "00".repeat(28),
    epoch:            0n,
    consumed_proposals: [],
  };

  // Tự kiểm off-chain trước (seedDatumOk).
  const seedValueMap = { "|": SEED_LOVELACE }; // chỉ ADA (LAMP chưa trong seed)
  if (!seedDatumOk(seedValueMap, seedDatum, SEED_LOVELACE)) {
    throw new Error("seed datum không hợp lệ off-chain — kiểm tra accepted_assets / ledger.");
  }

  // Build + submit seed tx.
  const tx = await lucid.newTx()
    .pay.ToAddressWithData(custAddr, { kind: "inline", value: custodyDatumToCbor(seedDatum) }, { lovelace: SEED_LOVELACE })
    .complete();
  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();
  console.log("\n   TX:       ", txHash);
  console.log("   Explorer :", explorerTx(txHash));
  await awaitTx(lucid, txHash, "deploy-custody");

  // Lưu state.
  saveDeployed({
    network: NETWORK,
    custody: { hash: "n/a (seed, no NFT)", address: custAddr },
    lamp: { policyId: LAMP_POLICY_ID, assetName: LAMP_ASSET_NAME },
    genesis: { txHash, outputIndex: 0 },
  });

  console.log("\n✅ Custody instance OriLife (cut_bps=10000) đã deploy trên", NETWORK);
  console.log("   Chạy tiếp: npx tsx scripts/02_collect_preview.ts");
  void Data; void assetsToMap;
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.stack ?? e.message : e); process.exit(1); });
