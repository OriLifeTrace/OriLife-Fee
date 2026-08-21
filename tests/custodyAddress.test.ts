// Pins the deployed custody address to the vendored blueprint.
//
// Why this test exists, and why it is in the CORE suite: the CI gate cannot compile or run
// src/treasuryClient.ts, e2e/ or scripts/*_preview.ts, because they import LAMP through
// vendor/lamp and the LAMP repository is not available in CI. That leaves the whole
// money-spending layer outside the gate.
//
// This test closes part of that gap without needing LAMP at all. It reads the vendored blueprint,
// applies the same two parameters the deployment used, derives the script address, and compares it
// against scripts/deployed_preview.json — the address that actually holds assets today.
//
// It therefore fails the moment anyone rebuilds the blueprint against a newer LAMP (a rebuild
// changes the parameter list, the compiled code, the script hash, and so the address), which is
// exactly the mistake scripts/pin-lamp.sh exists to prevent.

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
/** Milliseconds per epoch, as applied at deployment. */
const MS_PER_EPOCH_PREVIEW = 432_000_000n;

interface Blueprint {
  validators: { title: string; compiledCode: string; parameters?: unknown[] }[];
}

function loadBlueprint(): Blueprint {
  return JSON.parse(
    readFileSync(resolve(ROOT, "vendor/treasury-custody.plutus.json"), "utf8"),
  ) as Blueprint;
}

function loadDeployed(): { network: Network; custody: { address: string } } {
  return JSON.parse(readFileSync(resolve(ROOT, "scripts/deployed_preview.json"), "utf8"));
}

describe("custody blueprint <-> deployed address", () => {
  it("custody.custody.spend still takes exactly 2 parameters", () => {
    const v = loadBlueprint().validators.find((x) => x.title === "custody.custody.spend");
    expect(v, "custody.custody.spend missing from the vendored blueprint").toBeDefined();
    // Three parameters means the blueprint was rebuilt against a LAMP newer than the pin.
    expect(v!.parameters?.length).toBe(2);
  });

  it("derives exactly the address recorded in deployed_preview.json", () => {
    const deployed = loadDeployed();
    const v = loadBlueprint().validators.find((x) => x.title === "custody.custody.spend")!;
    const validator: Validator = {
      type: "PlutusV3",
      script: applyParamsToScript(v.compiledCode, [
        PROPOSAL_POLICY_PLACEHOLDER, MS_PER_EPOCH_PREVIEW,
      ] as never),
    };
    const address = credentialToAddress(
      deployed.network, scriptHashToCredential(validatorToScriptHash(validator)),
    );
    expect(address).toBe(deployed.custody.address);
  });

  it("the recorded address is the one that holds assets today", () => {
    // Written out so a reader does not have to trust the JSON alone. Measured 2026-08-21 on
    // Preview: 12 ADA, 19,500,000 LAMP, two other fungible batches, and two NFTs. See STATUS.md.
    expect(loadDeployed().custody.address).toBe(
      "addr_test1wzz0uxpt58vllu2patcldqa7dvgwkr2j5yagcs8s9lmh37gq34gs9",
    );
  });
});
