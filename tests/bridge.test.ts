import { describe, it, expect } from "vitest";
import {
  quoteToCollectItems, totalItemOil, assertBridgeInvariants, utf8ToHex,
  ORILIFE_CUT_BPS, type BridgeConfig,
} from "../src/bridge.js";
import { quoteFee } from "../src/feeEngine.js";

const CFG: BridgeConfig = {
  appIdHex: utf8ToHex("orilife"),
  lampPolicyHex: "a".repeat(56),
  lampNameHex: "4c414d50",
};

describe("utf8ToHex", () => {
  it("orilife -> hex", () => {
    expect(utf8ToHex("orilife")).toBe("6f72696c696665");
  });
});

describe("quoteToCollectItems", () => {
  it("maps every bucket with oil>0 to one item, with the right category and asset", () => {
    const q = quoteFee({ task: "animal.enroll", declaredValueUsd: 1000, anchorTier: "immediate" });
    const items = quoteToCollectItems(q, CFG);
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.app_id).toBe(CFG.appIdHex);
      expect(it.policy).toBe(CFG.lampPolicyHex);
      expect(it.name).toBe(CFG.lampNameHex);
      expect(it.amount).toBeGreaterThan(0n);
    }
    // categories match the corresponding buckets
    const cats = items.map((i) => i.category).sort();
    expect(cats).toEqual([0n, 1n, 2n]);
  });

  it("Σ item.amount == feeOil (cut_bps=10000 means cut=amount)", () => {
    const q = quoteFee({ task: "tree.register", declaredValueUsd: 500, lifecycleEvents: 2 });
    const items = quoteToCollectItems(q, CFG);
    expect(totalItemOil(items)).toBe(q.feeOil);
  });

  it("skips buckets whose oil is 0", () => {
    // a very small feeOil can leave protocol/anchor at 0, so those items are filtered out
    const q = quoteFee({ task: "fruit.qr", anchorTier: "no_anchor" });
    const items = quoteToCollectItems(q, CFG);
    for (const it of items) expect(it.amount).toBeGreaterThan(0n);
    // the total still matches — nothing is lost by dropping the zero buckets
    expect(totalItemOil(items)).toBe(q.feeOil);
  });
});

describe("assertBridgeInvariants", () => {
  it("cut_bps of exactly 10000 with a matching Σ does not throw", () => {
    const q = quoteFee({ task: "animal.enroll", declaredValueUsd: 1000 });
    const items = quoteToCollectItems(q, CFG);
    expect(() => assertBridgeInvariants(q, items, ORILIFE_CUT_BPS)).not.toThrow();
  });

  it("cut_bps other than 10000 -> BRIDGE-001", () => {
    const q = quoteFee({ task: "animal.enroll", declaredValueUsd: 1000 });
    const items = quoteToCollectItems(q, CFG);
    expect(() => assertBridgeInvariants(q, items, 700n)).toThrow(/BRIDGE-001/);
  });

  it("Σ items other than feeOil -> BRIDGE-002", () => {
    const q = quoteFee({ task: "animal.enroll", declaredValueUsd: 1000 });
    const items = quoteToCollectItems(q, CFG);
    items[0]!.amount += 1n; // break the total
    expect(() => assertBridgeInvariants(q, items, ORILIFE_CUT_BPS)).toThrow(/BRIDGE-002/);
  });
});
