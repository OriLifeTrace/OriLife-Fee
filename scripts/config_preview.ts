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
/**
 * Milliseconds per epoch on Preview. The Preview network runs ONE day per epoch; 432_000_000
 * (five days) is Preprod's and mainnet's pace, and it does not belong on this network.
 *
 * This constant is an apply-param. Changing it changes the compiled script, so it changes the
 * script hash, so it changes THE ADDRESS. That is why the wrong value here was never going to
 * surface as an error: every transaction still builds, it just builds against a different
 * instance, and nothing anywhere goes red.
 */
export const MS_PER_EPOCH_PREVIEW = 86_400_000n; // 1 Preview day per epoch

/**
 * What the custody instance CURRENTLY HOLDING ASSETS was applied with. This is a fact about the
 * chain, not a choice — it is 432_000_000 because that is what the deploy used, and no edit here
 * changes what is already on Preview.
 *
 * Kept as a separate named constant rather than deleted, because the assets are only reachable
 * through a validator built with this value. Deleting it would not remove the old instance; it
 * would only remove the way back to it.
 */
export const MS_PER_EPOCH_DEPLOYED = 432_000_000n; // the live instance, addr_test1wzz0u...

function buildCustodyValidator(msPerEpoch: bigint): Validator {
  return {
    type: "PlutusV3",
    script: applyParamsToScript(loadCustodyCompiledCode(), [
      PROPOSAL_POLICY_PLACEHOLDER, msPerEpoch,
    ] as never),
  };
}

/**
 * The custody validator at the CORRECT Preview pace. A deploy run today produces this one, at a
 * NEW address that holds nothing yet.
 *
 * Do not use this to reach the assets already on chain — see deployedCustodyValidator().
 */
export function custodyValidator(): Validator {
  return buildCustodyValidator(MS_PER_EPOCH_PREVIEW);
}

/**
 * The custody validator matching the instance that holds assets today. This is the ONLY one whose
 * hash matches those UTxOs, so it is the only one that can spend them.
 *
 * The two builders are separate functions, not one function with a flag, so that every call site
 * has to say in its own text which instance it means. Before this split there was one builder and
 * one constant, and a script could load the deployed address on one line and derive a different
 * validator on the next — which is exactly what happened, and it produced no error of any kind.
 */
export function deployedCustodyValidator(): Validator {
  return buildCustodyValidator(MS_PER_EPOCH_DEPLOYED);
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
  let state: OriLifeDeployedState;
  try {
    state = JSON.parse(readFileSync(DEPLOYED_PATH, "utf8")) as OriLifeDeployedState;
  } catch {
    throw new Error("no deployed_preview.json yet — run 01_deploy_custody_preview.ts first.");
  }
  // Fail closed. The recorded address and deployedCustodyValidator() must agree, because a script
  // that reads one and derives the other builds a transaction against an instance that does not
  // hold the UTxOs it names — and that failure is silent: the build succeeds.
  const derived = custodyAddress(deployedCustodyValidator());
  if (state.custody.address !== derived) {
    throw new Error(
      "deployed_preview.json does not match deployedCustodyValidator().\n"
      + `  recorded: ${state.custody.address}\n`
      + `  derived : ${derived}\n`
      + "Either MS_PER_EPOCH_DEPLOYED no longer describes the live instance, or the vendored "
      + "blueprint was rebuilt (see scripts/pin-lamp.sh). Do not 'fix' this by editing the JSON "
      + "to match the code — the JSON records what is on chain.");
  }
  return state;
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
