// OriLife — a reusable emulator harness: runs the whole fee -> Collect flow through the REAL
// custody Plutus validator inside the Lucid Emulator, and returns the on-chain measurements for a
// script to print or a test to assert on.

import {
  Emulator, generateEmulatorAccount, Lucid, Data,
  applyParamsToScript, validatorToScriptHash, scriptHashToCredential, credentialToAddress,
  type Validator, type Network, type LucidEvolution, type UTxO,
} from "@lucid-evolution/lucid";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { custodyDatumToCbor, decodeCustodyDatum } from "../vendor/lamp/Treasury/offchain/src/datum.js";
import { ledgerGet } from "../vendor/lamp/Treasury/offchain/src/collect.js";
import type { CustodyDatum } from "../vendor/lamp/Treasury/offchain/src/types.js";

import { quoteFee, type QuoteInput, type FeeQuote } from "../src/feeEngine.js";
import { buildFeeCollectTx } from "../src/treasuryClient.js";
import { utf8ToHex, type BridgeConfig, type CollectItem } from "../src/bridge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const NETWORK: Network = "Custom";
export const LAMP_POLICY = "f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0";
export const LAMP_NAME = "4c414d50"; // "LAMP"
export const LAMP_UNIT = LAMP_POLICY + LAMP_NAME;
export const SEED_ADA = 5_000_000n;

export const CFG: BridgeConfig = {
  appIdHex: utf8ToHex("orilife"), lampPolicyHex: LAMP_POLICY, lampNameHex: LAMP_NAME,
};

export interface CollectStepResult {
  txHash: string;
  quote: FeeQuote;
  items: CollectItem[];
  cutLamp: bigint;
  lampAfter: bigint;
  adaAfter: bigint;
  ledgerAfter: { protocol: bigint; lampnet: bigint; anchor: bigint };
  datumAfter: CustodyDatum;
  summary: string;
}

export interface EmulatorCollectResult extends CollectStepResult {
  custodyAddress: string;
}

interface Env {
  lucid: LucidEvolution;
  emulator: Emulator;
  custodyScript: Validator;
  custodyAddress: string;
}

function loadCustodyCompiledCode(): string {
  // The blueprint comes from vendor/ and is NEVER rebuilt from LAMP HEAD: HEAD takes 3 parameters
  // and produces a different script hash, i.e. a different address from the deployed custody.
  // See scripts/pin-lamp.sh.
  const p = resolve(__dirname, "../vendor/treasury-custody.plutus.json");
  const json = JSON.parse(readFileSync(p, "utf8")) as { validators: { title: string; compiledCode: string; parameters?: unknown[] }[] };
  const v = json.validators.find((x) => x.title === "custody.custody.spend");
  if (!v) throw new Error("custody.custody.spend not found in the vendored blueprint.");
  if (!v.parameters || v.parameters.length !== 2) {
    throw new Error(
      "custody.custody.spend no longer takes 2 parameters — the blueprint has been rebuilt against "
      + "a newer LAMP. Restore the file from git; do not rebuild it. See scripts/pin-lamp.sh.");
  }
  return v.compiledCode;
}

async function setupEnv(): Promise<Env> {
  const account = generateEmulatorAccount({ lovelace: 10_000_000_000n, [LAMP_UNIT]: 1_000_000_000n });
  const emulator = new Emulator([account]);
  const lucid = await Lucid(emulator, NETWORK);
  lucid.selectWallet.fromSeed(account.seedPhrase);

  const custodyScript: Validator = {
    type: "PlutusV3",
    script: applyParamsToScript(loadCustodyCompiledCode(), ["00".repeat(28), 432_000_000n] as never),
  };
  const custodyAddress = credentialToAddress(NETWORK, scriptHashToCredential(validatorToScriptHash(custodyScript)));
  return { lucid, emulator, custodyScript, custodyAddress };
}

async function seedCustody(env: Env): Promise<UTxO> {
  const seedDatum: CustodyDatum = {
    instance_id: utf8ToHex("orilife-fee-v1"),
    accepted_assets: [{ policy: LAMP_POLICY, name: LAMP_NAME }],
    ledger: [],
    cut_bps: 10_000n,
    governance_ref: "00".repeat(28),
    epoch: 0n,
    consumed_proposals: [],
  };
  const tx = await env.lucid.newTx()
    .pay.ToAddressWithData(env.custodyAddress, { kind: "inline", value: custodyDatumToCbor(seedDatum) }, { lovelace: SEED_ADA })
    .complete();
  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();
  env.emulator.awaitBlock(1);
  const u = (await env.lucid.utxosAt(env.custodyAddress)).find((x) => x.txHash === txHash && x.datum);
  if (!u) throw new Error("seed custody UTxO not found after submit.");
  return u;
}

async function collectStep(env: Env, custodyUtxo: UTxO, quoteInput: QuoteInput): Promise<{ result: CollectStepResult; nextUtxo: UTxO }> {
  const quote = quoteFee(quoteInput);
  const { tx, items, cutValue, summary } = await buildFeeCollectTx({
    lucid: env.lucid, network: NETWORK, custodyUtxo, custodyScript: env.custodyScript, quote, cfg: CFG,
  });
  const cutLamp = cutValue[`${LAMP_POLICY}|${LAMP_NAME}`] ?? 0n;

  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();
  env.emulator.awaitBlock(1);

  const after = (await env.lucid.utxosAt(env.custodyAddress)).find((u) => u.txHash === txHash && u.datum);
  if (!after) throw new Error("custody UTxO not found after the collect.");
  const datumAfter = decodeCustodyDatum(Data.from(after.datum!));

  const result: CollectStepResult = {
    txHash, quote, items, cutLamp, summary,
    lampAfter: after.assets[LAMP_UNIT] ?? 0n,
    adaAfter: after.assets["lovelace"] ?? 0n,
    ledgerAfter: {
      protocol: ledgerGet(datumAfter.ledger, 0n, LAMP_POLICY, LAMP_NAME),
      lampnet: ledgerGet(datumAfter.ledger, 1n, LAMP_POLICY, LAMP_NAME),
      anchor: ledgerGet(datumAfter.ledger, 2n, LAMP_POLICY, LAMP_NAME),
    },
    datumAfter,
  };
  return { result, nextUtxo: after };
}

/** Run one Collect transaction (an OriLife fee into the three treasury buckets) through the real
 *  Plutus validator. */
export async function runEmulatorCollect(quoteInput: QuoteInput): Promise<EmulatorCollectResult> {
  const env = await setupEnv();
  const seed = await seedCustody(env);
  const { result } = await collectStep(env, seed, quoteInput);
  return { ...result, custodyAddress: env.custodyAddress };
}

/** Run SEVERAL Collects in a row on the SAME custody (covers the incremental ledger branch, where
 *  an existing row is added to). */
export async function runEmulatorMultiCollect(quoteInputs: QuoteInput[]): Promise<CollectStepResult[]> {
  const env = await setupEnv();
  let utxo = await seedCustody(env);
  const out: CollectStepResult[] = [];
  for (const qi of quoteInputs) {
    const { result, nextUtxo } = await collectStep(env, utxo, qi);
    out.push(result);
    utxo = nextUtxo;
  }
  return out;
}
