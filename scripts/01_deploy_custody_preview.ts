// OriLife Fee — deploy a custody instance on the Preview testnet.
// A special instance: cut_bps=10000 (pure deposit) with instance_id="orilife-fee-v1".
// Accepted asset: the LAMP named by LAMP_POLICY_ID in this repository's .env (see .env.example).
//
// Run: npx tsx scripts/01_deploy_custody_preview.ts

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

  // Seed datum: cut_bps=10000, an empty ledger, LAMP as the accepted asset.
  const seedDatum: CustodyDatum = {
    instance_id:      utf8ToHex("orilife-fee-v1"),
    accepted_assets:  [{ policy: LAMP_POLICY_ID, name: LAMP_ASSET_NAME }],
    ledger:           [],
    cut_bps:          10_000n,
    governance_ref:   "00".repeat(28),
    epoch:            0n,
    consumed_proposals: [],
  };

  // Self-check off-chain first (seedDatumOk).
  const seedValueMap = { "|": SEED_LOVELACE }; // ADA only — no LAMP in the seed yet
  if (!seedDatumOk(seedValueMap, seedDatum, SEED_LOVELACE)) {
    throw new Error("the seed datum is invalid off-chain — check accepted_assets and ledger.");
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

  // Persist the deployed state.
  saveDeployed({
    network: NETWORK,
    custody: { hash: "n/a (seed, no NFT)", address: custAddr },
    lamp: { policyId: LAMP_POLICY_ID, assetName: LAMP_ASSET_NAME },
    genesis: { txHash, outputIndex: 0 },
  });

  console.log("\nOriLife custody instance (cut_bps=10000) deployed on", NETWORK);
  console.log("   Next: npx tsx scripts/02_collect_preview.ts");
  void Data; void assetsToMap;
}

main().catch((e) => { console.error("❌", e instanceof Error ? e.stack ?? e.message : e); process.exit(1); });
