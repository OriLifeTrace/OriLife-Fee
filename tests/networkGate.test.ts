// Pins the network gate in scripts/config_preview.ts: these scripts may run on Preview and
// Preprod, and on nothing else.
//
// Why a separate file rather than another block in custodyAddress.test.ts: that file is about ONE
// custody instance and the address that identifies it. This one is about what the process is
// allowed to do before any instance is named. Folding them together would hide a failure here
// under a heading about addresses.
//
// What the gate is worth, stated at its real strength: it closes the door that NETWORK opens.
// scripts/config_preview.ts reads NETWORK from the environment and CASTS it to Network, so the
// compiler never sees a wrong value, and every later step succeeds on Mainnet — Blockfrost serves
// the URL, the address derives, the wallet holds real funds. assertEnv() previously only asked
// whether three variables were non-empty, so nothing anywhere read the network at all.
//
// It does NOT protect the emulator path or onchain/scripts/*.mjs: neither imports this module.
// e2e/harness.ts declares its own NETWORK = "Custom" and builds its own Lucid, and
// onchain/scripts/common.mjs hard-codes NETWORK = "Preprod" as a module constant with no
// environment override. Both are outside this test's reach, and outside the gate's.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { assertTestnetNetwork, ALLOWED_NETWORKS } from "../scripts/config_preview.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

describe("network gate", () => {
  it("refuses Mainnet, and says which variable and which value", () => {
    // Both halves matter. A guard that throws a bare "wrong network" sends the reader looking for
    // a wrong deployment record — the other guard in this module — instead of at their shell.
    expect(() => assertTestnetNetwork("Mainnet")).toThrow(/NETWORK/);
    expect(() => assertTestnetNetwork("Mainnet")).toThrow(/"Mainnet"/);
  });

  it("refuses anything outside the set, not just Mainnet", () => {
    // The gate is an allow-list, not a Mainnet block. A deny-list would pass every typo, and a
    // typo reaches the same place as Mainnet does: NETWORK is cast, so "mainnet" in the wrong case
    // is a value the compiler accepts too.
    for (const bad of ["mainnet", "MAINNET", "Custom", "preview", "", "Preprodd"]) {
      expect(() => assertTestnetNetwork(bad), `"${bad}" should be refused`).toThrow(/NETWORK/);
    }
  });

  it("lets Preview and Preprod through", () => {
    // The opposite pole, and the reason it is written out: a gate that refused everything would
    // pass every test above while making the scripts unrunnable.
    expect(() => assertTestnetNetwork("Preview")).not.toThrow();
    expect(() => assertTestnetNetwork("Preprod")).not.toThrow();
    expect([...ALLOWED_NETWORKS]).toEqual(["Preview", "Preprod"]);
  });

  it("never echoes a secret in the refusal", () => {
    // The message quotes the rejected NETWORK, which is not a secret. This pins that it quotes
    // nothing else: a guard that dumps the environment to be helpful would put a Blockfrost key
    // and a seed phrase into whatever log the run writes to, and a value on a screen is already
    // in the session record.
    const before = { key: process.env.BLOCKFROST_KEY, seed: process.env.WALLET_SEED };
    process.env.BLOCKFROST_KEY = "sentinel-blockfrost-value";
    process.env.WALLET_SEED = "sentinel seed phrase value";
    try {
      const message = (() => {
        try { assertTestnetNetwork("Mainnet"); return ""; }
        catch (e) { return String((e as Error).message); }
      })();
      expect(message).not.toBe("");
      expect(message).not.toContain("sentinel-blockfrost-value");
      expect(message).not.toContain("sentinel seed phrase value");
    } finally {
      if (before.key === undefined) delete process.env.BLOCKFROST_KEY;
      else process.env.BLOCKFROST_KEY = before.key;
      if (before.seed === undefined) delete process.env.WALLET_SEED;
      else process.env.WALLET_SEED = before.seed;
    }
  });

  it("assertEnv() itself refuses Mainnet, and refuses it BEFORE asking for secrets", async () => {
    // Every test above pins the guard as a FUNCTION. None of them pins it as a CALL: delete the
    // line inside assertEnv() and they all stay green, because they invoke the guard themselves.
    //
    // So this one goes through assertEnv() with NETWORK pointed at Mainnet and the three required
    // variables deliberately EMPTY. With the call in place the network refusal comes out; without
    // it, the first thing raised is "Missing BLOCKFROST_KEY" — which reads like a setup problem
    // and invites the reader to supply the key and try again, on Mainnet.
    const before = {
      net: process.env.NETWORK,
      key: process.env.BLOCKFROST_KEY,
      seed: process.env.WALLET_SEED,
      lamp: process.env.LAMP_POLICY_ID,
    };
    process.env.NETWORK = "Mainnet";
    process.env.BLOCKFROST_KEY = "";
    process.env.WALLET_SEED = "";
    process.env.LAMP_POLICY_ID = "";
    vi.resetModules();
    try {
      const fresh = await import("../scripts/config_preview.js");
      expect(fresh.NETWORK).toBe("Mainnet");
      expect(() => fresh.assertEnv()).toThrow(/NETWORK is not one of the testnets/);
      expect(() => fresh.assertEnv()).not.toThrow(/Missing BLOCKFROST_KEY/);
    } finally {
      for (const [k, v] of [
        ["NETWORK", before.net], ["BLOCKFROST_KEY", before.key],
        ["WALLET_SEED", before.seed], ["LAMP_POLICY_ID", before.lamp],
      ] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      vi.resetModules();
    }
  });

  it("makeLucid() reaches the network only through assertEnv()", () => {
    // makeLucid() cannot be called here — it opens a Blockfrost connection. This reads the module
    // as text instead, and pins the ORDER: the gate stands ahead of the Lucid construction.
    //
    // Stated at its real strength: it pins that the call is present and stands first. It does not
    // execute either one. Matched at the start of a line so that the function's own name inside a
    // doc comment is not counted as a call.
    const lines = readFileSync(resolve(ROOT, "scripts/config_preview.ts"), "utf8").split("\n");
    const body = lines.findIndex((l) => /^export async function makeLucid\(/.test(l));
    expect(body, "makeLucid is gone — this test is measuring the wrong file").toBeGreaterThan(-1);
    const rest = lines.slice(body);
    const guard = rest.findIndex((l) => /^\s*assertEnv\(\);/.test(l));
    const connect = rest.findIndex((l) => /^\s*const lucid = await Lucid\(/.test(l));
    expect(guard, "assertEnv() is not called inside makeLucid()").toBeGreaterThan(-1);
    expect(connect, "Lucid() is not constructed here").toBeGreaterThan(-1);
    expect(guard).toBeLessThan(connect);
  });
});
