// Preview-testnet configuration for the orilife-fee scripts.
//
// Secrets (the Blockfrost key, the wallet seed) come from ENVIRONMENT VARIABLES, or from THIS
// repository's own `.env`. This file used to load the LAMP repository's `.env` through a relative
// path that escaped the repo root: when one repository reads another's secret file, nobody can
// audit which repository holds what, and the path breaks the moment someone lays the two repos out
// differently. `.env` is in `.gitignore`; see `.env.example` for the variables you need.

import dotenv from "dotenv";
import {
  Lucid, Blockfrost,
  applyParamsToScript, validatorToScriptHash, scriptHashToCredential, credentialToAddress,
  type LucidEvolution, type Validator, type Network,
} from "@lucid-evolution/lucid";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: resolve(__dirname, "../.env") });

export const NETWORK: Network = (process.env.NETWORK ?? "Preview") as Network;
export const BLOCKFROST_URL = `https://cardano-${NETWORK.toLowerCase()}.blockfrost.io/api/v0`;
export const BLOCKFROST_KEY = process.env.BLOCKFROST_KEY ?? "";
export const WALLET_SEED    = (process.env.WALLET_SEED ?? "").trim().replace(/\s+/g, " ");
export const LAMP_POLICY_ID = (process.env.LAMP_POLICY_ID ?? "").trim();
export const LAMP_ASSET_NAME = (process.env.LAMP_ASSET_NAME ?? "4c414d50").trim();

/** The instance_id of the OriLife fee custody instance, as UTF-8.
 *  Several custody instances share one script address (the address is derived from the parameters,
 *  not from the instance), so anything reading "the custody UTxO" MUST select by instance_id.
 *  Picking the first UTxO that merely has a datum can land on somebody else's ledger. */
export const INSTANCE_ID = "orilife-fee-v1";

/** LAMP unit (policy + name, in Lucid format). */
export const LAMP_UNIT = LAMP_POLICY_ID + LAMP_ASSET_NAME;

// The blueprint is vendored, so it does not depend on anything LAMP happens to have on disk.
const BLUEPRINT_PATH = resolve(__dirname, "../vendor/treasury-custody.plutus.json");

export function loadCustodyCompiledCode(): string {
  const json = JSON.parse(readFileSync(BLUEPRINT_PATH, "utf8")) as {
    validators: { title: string; compiledCode: string; parameters?: unknown[] }[];
  };
  const v = json.validators.find((x) => x.title === "custody.custody.spend");
  if (!v) throw new Error("custody.custody.spend not found in the vendored blueprint.");
  if (!v.parameters || v.parameters.length !== 2) {
    throw new Error(
      "the blueprint no longer takes 2 parameters — it has been rebuilt against a newer LAMP, and "
      + "that build produces a DIFFERENT script hash, i.e. a different address from the custody "
      + "deployed in scripts/deployed_preview.json. Restore the file from git; do not rebuild it. "
      + "See scripts/pin-lamp.sh.");
  }
  return v.compiledCode;
}

/** Placeholder proposal_policy (28-byte hex) — Collect does not use it. */
export const PROPOSAL_POLICY_PLACEHOLDER = "00".repeat(28);
/** Milliseconds per epoch. */
export const MS_PER_EPOCH_PREVIEW = 432_000_000n; // 5 testnet days per epoch

/** Apply the custody validator with the canonical parameters. */
export function custodyValidator(): Validator {
  return {
    type: "PlutusV3",
    script: applyParamsToScript(loadCustodyCompiledCode(), [
      PROPOSAL_POLICY_PLACEHOLDER, MS_PER_EPOCH_PREVIEW,
    ] as never),
  };
}

export function custodyAddress(v: Validator): string {
  return credentialToAddress(NETWORK, scriptHashToCredential(validatorToScriptHash(v)));
}

const ENV_HINT = "Set it as an environment variable, or add it to this repository's .env "
  + "(see .env.example).";

export function assertEnv(): void {
  if (!BLOCKFROST_KEY) throw new Error(`Missing BLOCKFROST_KEY. ${ENV_HINT}`);
  if (!WALLET_SEED)    throw new Error(`Missing WALLET_SEED. ${ENV_HINT}`);
  if (!LAMP_POLICY_ID) throw new Error(`Missing LAMP_POLICY_ID. ${ENV_HINT}`);
}

export async function makeLucid(): Promise<LucidEvolution> {
  assertEnv();
  const lucid = await Lucid(new Blockfrost(BLOCKFROST_URL, BLOCKFROST_KEY), NETWORK);
  lucid.selectWallet.fromSeed(WALLET_SEED);
  return lucid;
}

export function explorerTx(hash: string): string {
  return `https://${NETWORK.toLowerCase()}.cardanoscan.io/transaction/${hash}`;
}

// deployed.json for orilife-fee/scripts/
export const DEPLOYED_PATH = resolve(__dirname, "deployed_preview.json");

export interface OriLifeDeployedState {
  network: Network;
  custody: { hash: string; address: string };
  lamp: { policyId: string; assetName: string };
  genesis?: { txHash: string; outputIndex: number };
}

export function loadDeployed(): OriLifeDeployedState {
  try {
    return JSON.parse(readFileSync(DEPLOYED_PATH, "utf8")) as OriLifeDeployedState;
  } catch {
    throw new Error("no deployed_preview.json yet — run 01_deploy_custody_preview.ts first.");
  }
}

export function saveDeployed(s: OriLifeDeployedState): void {
  writeFileSync(DEPLOYED_PATH, JSON.stringify(s, null, 2) + "\n");
}

export async function awaitTx(lucid: LucidEvolution, txHash: string, label = ""): Promise<void> {
  process.stdout.write(`   waiting for ${label} ${txHash.slice(0, 12)} to confirm... `);
  const ok = await lucid.awaitTx(txHash, 300_000); // 5-minute timeout
  if (!ok) throw new Error(`tx ${txHash} did not confirm before the timeout`);
  console.log("✓");
}
