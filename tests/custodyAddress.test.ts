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

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  applyParamsToScript, validatorToScriptHash, scriptHashToCredential, credentialToAddress,
  type Validator, type Network,
} from "@lucid-evolution/lucid";
import {
  assertRecordedNetwork, assertNoOtherInstanceRecorded, recordedCustodyAddress,
} from "../scripts/config_preview.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

/** Placeholder proposal_policy (28-byte hex) — Collect does not use it. */
const PROPOSAL_POLICY_PLACEHOLDER = "00".repeat(28);

// These two are COPIES of scripts/config_preview.ts, kept so that the derivation below runs on
// values this file names in plain text rather than on whatever the config currently says.
//
// An earlier version of this note said the copy existed because importing config_preview.ts pulls
// in LAMP. That is not true — measured 2026-09-21, its imports are dotenv, @lucid-evolution/lucid
// and three node builtins, and nothing in the module body touches the network. The note mattered
// because it was the reason nobody imported the real module, which is why the guards inside it went
// untested; they are imported and pinned at the bottom of this file now.
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
  const digits = new RegExp(`export const ${name} = ([0-9_]+)n;`).exec(src)?.[1];
  // Bound to a const first. Indexing a match array is `string | undefined` under
  // noUncheckedIndexedAccess, and narrowing the array element in place does not survive the next
  // statement — which is what made tsc red on this line while vitest stayed green.
  if (digits === undefined) throw new Error(`${name} not found in scripts/config_preview.ts`);
  return BigInt(digits.replace(/_/g, ""));
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

describe("the two guards in config_preview.ts", () => {
  it("an address comparison cannot tell Preview from Preprod", () => {
    // This is the measurement the network check rests on, and without it that check reads as
    // belt-and-braces next to the address check right below it. networkToId() in
    // @lucid-evolution/utils returns 0 for Preview, Preprod AND Custom, so the same script hash
    // renders to the same bech32 string on all three: point NETWORK at Preprod and the address
    // check still passes, while every transaction goes to a different chain.
    const deployed = loadDeployedJson();
    expect(deriveAddress(MS_PER_EPOCH_DEPLOYED, "Preprod" as Network))
      .toBe(deployed.custody.address);
  });

  it("a recorded network other than the configured one is refused", () => {
    expect(() => assertRecordedNetwork("Preview" as Network, "Preprod" as Network))
      .toThrow(/different network/);
    expect(() => assertRecordedNetwork("Preprod" as Network, "Preview" as Network))
      .toThrow(/different network/);
  });

  it("a matching network passes", () => {
    // The other pole. A check that throws on everything protects nothing, and it would still read
    // as green in a suite that only ever asserts the throw.
    expect(() => assertRecordedNetwork("Preview" as Network, "Preview" as Network)).not.toThrow();
  });

  it("a deploy over a DIFFERENT recorded instance is refused", () => {
    const deployed = loadDeployedJson();
    const corrected = deriveAddress(MS_PER_EPOCH_PREVIEW, deployed.network);
    // Not a hypothetical pair: these are exactly the two addresses a deploy run would hold today —
    // the record on disk, and what custodyValidator() derives now that the pace is the Preview one.
    expect(() => assertNoOtherInstanceRecorded(deployed.custody.address, corrected))
      .toThrow(/already records a DIFFERENT custody instance/);
  });

  it("a first deploy, and a redeploy of the same address, both pass", () => {
    // The two poles that keep the guard from being a blanket refusal: no record yet (the very
    // first deploy, which is what the script is for), and a record that already names this exact
    // address (a rerun after a failure part-way through).
    const addr = loadDeployedJson().custody.address;
    expect(() => assertNoOtherInstanceRecorded(null, addr)).not.toThrow();
    expect(() => assertNoOtherInstanceRecorded(addr, addr)).not.toThrow();
  });

  it("loadDeployed() itself refuses a record from another network", async () => {
    // Every test above pins the guard as a FUNCTION. None of them pins it as a CALL: delete the
    // line in loadDeployed() and they all stay green, because they invoke the guard themselves.
    //
    // So this one goes through loadDeployed() with NETWORK pointed at Preprod. dotenv does not
    // overwrite a variable that is already set, so the value here wins over any local .env. With
    // the call in place the load throws; without it the load SUCCEEDS, because the address check
    // that follows passes on Preprod — which is the whole reason the network check exists.
    const before = process.env.NETWORK;
    process.env.NETWORK = "Preprod";
    vi.resetModules();
    try {
      const fresh = await import("../scripts/config_preview.js");
      expect(fresh.NETWORK).toBe("Preprod");
      expect(() => fresh.loadDeployed()).toThrow(/different network/);
    } finally {
      if (before === undefined) delete process.env.NETWORK;
      else process.env.NETWORK = before;
      vi.resetModules();
    }
  });

  it("01_deploy_custody_preview.ts calls the overwrite guard before it writes", () => {
    // The deploy script runs main() at import time and pulls in vendor/lamp, so it cannot be
    // imported here. This reads it as text instead.
    //
    // Stated at its real strength: it pins that the call is present and stands ahead of the write.
    // It does not execute either one, so it cannot show the guard receives the right arguments —
    // only the tests above do that, and only for the function in isolation.
    // Matched at the start of a line, not anywhere in the text. A plain substring search counts
    // the name written inside a comment as a call — which it did on the first run here, and the
    // mention it found sat AFTER the write, so the test went red for a reason that was not true.
    const lines = readFileSync(resolve(ROOT, "scripts/01_deploy_custody_preview.ts"), "utf8")
      .split("\n");
    const guard = lines.findIndex((l) => /^\s*assertNoOtherInstanceRecorded\(/.test(l));
    const write = lines.findIndex((l) => /^\s*saveDeployed\(/.test(l));
    expect(guard, "the overwrite guard is not called at all").toBeGreaterThan(-1);
    expect(write, "saveDeployed is not called — this test is measuring the wrong file")
      .toBeGreaterThan(-1);
    expect(guard).toBeLessThan(write);
  });

  it("recordedCustodyAddress() reads the address the file actually holds", () => {
    // Pins the reader to the file rather than to a shape: a version that returns null on any
    // unexpected JSON would turn every later deploy into a silent overwrite, and the guard above
    // would still pass all of its own tests.
    expect(recordedCustodyAddress()).toBe(loadDeployedJson().custody.address);
  });
});
