// Pins the deployed custody address to the vendored blueprint, and pins the two epoch paces
// apart from each other.
//
// Why this test exists, and why it is in the CORE suite: the CI gate cannot compile or run
// src/treasuryClient.ts, e2e/ or scripts/*_preview.ts, because they import LAMP through
// vendor/lamp and the LAMP repository is not available in CI. That leaves the whole
// money-spending layer outside the gate.
//
// This test closes part of that gap without needing LAMP at all. It reads the vendored blueprint,
// applies the parameters, derives the script address, and compares it against
// scripts/deployed_preview.json — the address that actually holds assets today.
//
// It therefore fails the moment anyone rebuilds the blueprint against a newer LAMP (a rebuild
// changes the parameter list, the compiled code, the script hash, and so the address), which is
// exactly the mistake scripts/pin-lamp.sh exists to prevent.
//
// Since 2026-09-20 it also pins a second thing: Preview runs ONE day per epoch, and the instance
// holding assets was deployed with FIVE. Those are now two separate named constants in
// scripts/config_preview.ts, and the two must never collapse back into one.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  applyParamsToScript, validatorToScriptHash, scriptHashToCredential, credentialToAddress,
  type Validator, type Network,
} from "@lucid-evolution/lucid";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

/** Placeholder proposal_policy (28-byte hex) — Collect does not use it. */
const PROPOSAL_POLICY_PLACEHOLDER = "00".repeat(28);

// These two are COPIES of scripts/config_preview.ts. The copy is deliberate: importing that file
// pulls in LAMP, which CI does not have, and this test's whole value is that it runs without it.
//
// A copy that nothing checks goes stale silently, so the copy is checked — readConfigConstant()
// below reads the real file as text and the first test asserts both values still agree. That
// turns "someone edited the config and forgot the test" from a silent drift into a red run.
/** The pace Preview actually runs at: one day per epoch. */
const MS_PER_EPOCH_PREVIEW = 86_400_000n;
/** The pace the live instance was applied with. A fact about the chain, not a choice. */
const MS_PER_EPOCH_DEPLOYED = 432_000_000n;

interface Blueprint {
  validators: { title: string; compiledCode: string; parameters?: unknown[] }[];
}

function loadBlueprint(): Blueprint {
  return JSON.parse(
    readFileSync(resolve(ROOT, "vendor/treasury-custody.plutus.json"), "utf8"),
  ) as Blueprint;
}

function loadDeployedJson(): { network: Network; custody: { address: string } } {
  return JSON.parse(readFileSync(resolve(ROOT, "scripts/deployed_preview.json"), "utf8"));
}

/** Reads a `export const NAME = <digits>n;` value out of config_preview.ts, as text. */
function readConfigConstant(name: string): bigint {
  const src = readFileSync(resolve(ROOT, "scripts/config_preview.ts"), "utf8");
  const m = new RegExp(`export const ${name} = ([0-9_]+)n;`).exec(src);
  if (!m) throw new Error(`${name} not found in scripts/config_preview.ts`);
  return BigInt(m[1].replace(/_/g, ""));
}

function deriveAddress(msPerEpoch: bigint, network: Network): string {
  const v = loadBlueprint().validators.find((x) => x.title === "custody.custody.spend")!;
  const validator: Validator = {
    type: "PlutusV3",
    script: applyParamsToScript(v.compiledCode, [
      PROPOSAL_POLICY_PLACEHOLDER, msPerEpoch,
    ] as never),
  };
  return credentialToAddress(network, scriptHashToCredential(validatorToScriptHash(validator)));
}

describe("custody blueprint <-> deployed address", () => {
  it("the constants copied here still match scripts/config_preview.ts", () => {
    expect(readConfigConstant("MS_PER_EPOCH_PREVIEW")).toBe(MS_PER_EPOCH_PREVIEW);
    expect(readConfigConstant("MS_PER_EPOCH_DEPLOYED")).toBe(MS_PER_EPOCH_DEPLOYED);
  });

  it("custody.custody.spend still takes exactly 2 parameters", () => {
    const v = loadBlueprint().validators.find((x) => x.title === "custody.custody.spend");
    expect(v, "custody.custody.spend missing from the vendored blueprint").toBeDefined();
    // Three parameters means the blueprint was rebuilt against a LAMP newer than the pin.
    expect(v!.parameters?.length).toBe(2);
  });

  it("the DEPLOYED pace derives exactly the address recorded in deployed_preview.json", () => {
    const deployed = loadDeployedJson();
    expect(deriveAddress(MS_PER_EPOCH_DEPLOYED, deployed.network))
      .toBe(deployed.custody.address);
  });

  it("the CORRECT Preview pace derives a different, empty address", () => {
    // The negative pole. Without it, the test above passes just as happily if someone collapses
    // the two constants back into one 432_000_000 — the deployed address would still match, and
    // the wrong pace would be back with nothing red.
    //
    // It also records the new address in plain text, so the migration has a target written down
    // somewhere other than a script's output.
    const deployed = loadDeployedJson();
    const corrected = deriveAddress(MS_PER_EPOCH_PREVIEW, deployed.network);
    expect(corrected).not.toBe(deployed.custody.address);
    expect(corrected).toBe(
      "addr_test1wp44l22rl873nh43e3ptkpa7g2qh0qaeyvrc5mfqtysfjmgqlmsqd",
    );
  });

  it("the recorded address is the one that holds assets today", () => {
    // Written out so a reader does not have to trust the JSON alone. Measured 2026-08-21 on
    // Preview: 12 ADA, 19,500,000 LAMP, two other fungible batches, and two NFTs. See STATUS.md.
    //
    // Nothing here moves those assets. Correcting the pace changes which address a NEW deploy
    // lands on; it does not migrate anything, and this test stating the old address is the record
    // that a migration is still owed.
    expect(loadDeployedJson().custody.address).toBe(
      "addr_test1wzz0uxpt58vllu2patcldqa7dvgwkr2j5yagcs8s9lmh37gq34gs9",
    );
  });
});
