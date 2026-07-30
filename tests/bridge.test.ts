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
  it("orilife → hex", () => {
    expect(utf8ToHex("orilife")).toBe("6f72696c696665");
  });
});

describe("quoteToCollectItems", () => {
  it("map mỗi bucket oil>0 thành 1 item, đúng category + asset", () => {
    const q = quoteFee({ task: "animal.enroll", declaredValueUsd: 1000, anchorTier: "immediate" });
    const items = quoteToCollectItems(q, CFG);
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.app_id).toBe(CFG.appIdHex);
      expect(it.policy).toBe(CFG.lampPolicyHex);
      expect(it.name).toBe(CFG.lampNameHex);
      expect(it.amount).toBeGreaterThan(0n);
    }
    // category trùng với bucket tương ứng
    const cats = items.map((i) => i.category).sort();
    expect(cats).toEqual([0n, 1n, 2n]);
  });

  it("Σ item.amount == feeOil (cut_bps=10000 ⇒ cut=amount)", () => {
    const q = quoteFee({ task: "tree.register", declaredValueUsd: 500, lifecycleEvents: 2 });
    const items = quoteToCollectItems(q, CFG);
    expect(totalItemOil(items)).toBe(q.feeOil);
  });

  it("bỏ qua bucket oil==0", () => {
    // feeOil rất nhỏ có thể khiến protocol/anchor = 0 → item bị lọc
    const q = quoteFee({ task: "fruit.qr", anchorTier: "no_anchor" });
    const items = quoteToCollectItems(q, CFG);
    for (const it of items) expect(it.amount).toBeGreaterThan(0n);
    // tổng vẫn khớp (các bucket 0 không mất gì)
    expect(totalItemOil(items)).toBe(q.feeOil);
  });
});

describe("assertBridgeInvariants", () => {
  it("cut_bps đúng 10000 + Σ khớp → không ném", () => {
    const q = quoteFee({ task: "animal.enroll", declaredValueUsd: 1000 });
    const items = quoteToCollectItems(q, CFG);
    expect(() => assertBridgeInvariants(q, items, ORILIFE_CUT_BPS)).not.toThrow();
  });

  it("cut_bps ≠ 10000 → BRIDGE-001", () => {
    const q = quoteFee({ task: "animal.enroll", declaredValueUsd: 1000 });
    const items = quoteToCollectItems(q, CFG);
    expect(() => assertBridgeInvariants(q, items, 700n)).toThrow(/BRIDGE-001/);
  });

  it("Σ item ≠ feeOil → BRIDGE-002", () => {
    const q = quoteFee({ task: "animal.enroll", declaredValueUsd: 1000 });
    const items = quoteToCollectItems(q, CFG);
    items[0]!.amount += 1n; // phá tổng
    expect(() => assertBridgeInvariants(q, items, ORILIFE_CUT_BPS)).toThrow(/BRIDGE-002/);
  });
});
