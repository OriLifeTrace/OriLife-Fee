import { describe, it, expect, beforeEach } from "vitest";
import {
  quoteFee, splitOil, demandFactorFromSignals, DemandController,
} from "../src/feeEngine.js";
import { taskKeys, daoSetTask, getTask } from "../src/tasks.js";
import { daoSetLampUsd, LAMP_USD_DEFAULT, OIL_PER_LAMP } from "../src/params.js";

beforeEach(() => {
  daoSetLampUsd(LAMP_USD_DEFAULT); // reset the rate between tests
});

describe("splitOil — exact conservation, Σ buckets == feeOil", () => {
  // Sweep many values (odd, tiny, huge): anchor absorbs the remainder, never one oil short.
  const samples = [0n, 1n, 2n, 3n, 7n, 99n, 100n, 101n, 999_999n, 1_000_000n, 1_234_567n, 10n ** 12n + 7n];
  for (const v of samples) {
    it(`feeOil=${v}: protocol+lampnet+anchor == feeOil`, () => {
      const s = splitOil(v);
      expect(s.protocolOil + s.lampnetOil + s.anchorOil).toBe(v);
      expect(s.lampnetOil).toBe(s.storageOil + s.computeOil + s.bandwidthOil);
      // never negative
      for (const x of [s.protocolOil, s.lampnetOil, s.anchorOil]) expect(x >= 0n).toBe(true);
    });
  }
});

describe("quoteFee — Σ buckets conserved for EVERY task", () => {
  for (const key of taskKeys()) {
    it(`${key}: Σ bucket.oil == feeOil`, () => {
      const q = quoteFee({ task: key, declaredValueUsd: 1000, lifecycleEvents: 3 });
      const sum = q.buckets.reduce((a, b) => a + b.oil, 0n);
      expect(sum).toBe(q.feeOil);
      expect(q.buckets).toHaveLength(3);
    });
  }
});

describe("quoteFee — CEILING: fee <= 50% of the traditional cost", () => {
  it("a very high declared value still hits the cap, advantagePct >= 50", () => {
    const q = quoteFee({ task: "animal.enroll", declaredValueUsd: 1_000_000, anchorTier: "immediate" });
    const t = getTask("animal.enroll");
    expect(q.feeUsd).toBeLessThanOrEqual(t.traditionalCostUsd * 0.5 + 1e-9);
    expect(q.capped).toBe(true);
    expect(q.advantagePct).toBeGreaterThanOrEqual(50);
  });
});

describe("quoteFee — anchoring tier scales the fee monotonically (off-chain task, free tier)", () => {
  it("immediate > milestone > batch_daily > no_anchor (tree.scan is off-chain and uncapped)", () => {
    const mk = (tier: "no_anchor" | "batch_daily" | "milestone" | "immediate") =>
      quoteFee({ task: "tree.scan", anchorTier: tier, declaredValueUsd: 0 }).feeUsd;
    const no = mk("no_anchor"), bd = mk("batch_daily"), ms = mk("milestone"), im = mk("immediate");
    expect(no).toBeLessThan(bd);
    expect(bd).toBeLessThan(ms);
    expect(ms).toBeLessThanOrEqual(im);
  });
});

describe("quoteFee — L-1: an on-chain task cannot drop below its default tier", () => {
  it("fruit.register (default batch_daily) asking for no_anchor is raised back to batch_daily", () => {
    const asked = quoteFee({ task: "fruit.register", anchorTier: "no_anchor" });
    const def = quoteFee({ task: "fruit.register", anchorTier: "batch_daily" });
    expect(asked.anchorTier).toBe("batch_daily");
    expect(asked.feeUsd).toBe(def.feeUsd);
  });
  it("raising the tier (to immediate) on an on-chain task is still allowed", () => {
    const im = quoteFee({ task: "fruit.register", anchorTier: "immediate" });
    expect(im.anchorTier).toBe("immediate");
  });
  it("an off-chain task (tree.scan) may lower its tier freely", () => {
    expect(quoteFee({ task: "tree.scan", anchorTier: "no_anchor" }).anchorTier).toBe("no_anchor");
  });
});

describe("quoteFee — value-based pricing falls back to the FLOOR when the declared value is low", () => {
  it("a value below the floor is priced at the floor (under-declaration does not pay)", () => {
    const low = quoteFee({ task: "animal.enroll", declaredValueUsd: 1, anchorTier: "no_anchor" });
    const atFloor = quoteFee({ task: "animal.enroll", declaredValueUsd: 400, anchorTier: "no_anchor" });
    expect(low.feeUsd).toBe(atFloor.feeUsd); // floorValueUsd = 400
  });
  it("a task with valueBps=0 does not move with declaredValue", () => {
    const a = quoteFee({ task: "tree.scan", declaredValueUsd: 0 }).feeUsd;
    const b = quoteFee({ task: "tree.scan", declaredValueUsd: 999999 }).feeUsd;
    expect(a).toBe(b);
  });
});

describe("demandFactorFromSignals — clamped, and moves in the right direction", () => {
  it("demand above supply raises it (bounded at 3.0)", () => {
    const next = demandFactorFromSignals(1.0, 100, 50);
    expect(next).toBeGreaterThan(1.0);
    expect(next).toBeLessThanOrEqual(3.0);
  });
  it("supply above demand lowers it (bounded at 0.5)", () => {
    const next = demandFactorFromSignals(1.0, 10, 100);
    expect(next).toBeLessThan(1.0);
    expect(next).toBeGreaterThanOrEqual(0.5);
  });
  it("magicGenerated=0 keeps the previous value (clamped)", () => {
    expect(demandFactorFromSignals(1.0, 5, 0)).toBe(1.0);
  });
  it("each step changes it by at most 10%", () => {
    const next = demandFactorFromSignals(2.0, 1_000_000, 1);
    expect(next).toBeLessThanOrEqual(2.0 * 1.1 + 1e-9);
  });
});

describe("quoteFee — demand_factor scales the fee (while below the cap)", () => {
  it("higher demand means a higher fee", () => {
    const lo = quoteFee({ task: "fruit.register", demandFactor: 0.5, anchorTier: "no_anchor" }).feeUsd;
    const hi = quoteFee({ task: "fruit.register", demandFactor: 2.0, anchorTier: "no_anchor" }).feeUsd;
    expect(hi).toBeGreaterThan(lo);
  });
});

describe("quoteFee — the LAMP/USD rate moves the oil amount", () => {
  it("cheaper LAMP (a smaller USD/LAMP) needs more oil for the same USD fee", () => {
    const base = quoteFee({ task: "tree.register", demandFactor: 1, anchorTier: "no_anchor" });
    daoSetLampUsd(LAMP_USD_DEFAULT / 2); // 1 LAMP = $0.005
    const cheap = quoteFee({ task: "tree.register", demandFactor: 1, anchorTier: "no_anchor" });
    expect(cheap.feeOil).toBeGreaterThan(base.feeOil);
  });
});

describe("getTask — a mistyped key throws", () => {
  it("an unknown key throws", () => {
    expect(() => quoteFee({ task: "tree.unknown" })).toThrow(/TASK-001/);
  });
});

describe("daoSetTask — the DAO overrides a profile", () => {
  it("changing baseFeeUsd takes effect", () => {
    daoSetTask("fruit.qr", { baseFeeUsd: 0.999, traditionalCostUsd: 100 });
    const q = quoteFee({ task: "fruit.qr", anchorTier: "no_anchor" });
    expect(q.feeUsd).toBeGreaterThan(0.2); // clearly above the original 0.002
    daoSetTask("fruit.qr", { baseFeeUsd: 0.002, traditionalCostUsd: 0.2 }); // restore
  });
});

describe("oil units", () => {
  it("OIL_PER_LAMP = 1e6", () => {
    expect(OIL_PER_LAMP).toBe(1_000_000n);
  });
});

describe("M-1: bounds on the DAO setters", () => {
  it("daoSetLampUsd out of bounds -> PARAM-002", () => {
    expect(() => daoSetLampUsd(1e-300)).toThrow(/PARAM-00[12]/);
    expect(() => daoSetLampUsd(1e9)).toThrow(/PARAM-002/);
    daoSetLampUsd(LAMP_USD_DEFAULT);
  });
  it("a non-finite daoSetLampUsd -> PARAM-001", () => {
    expect(() => daoSetLampUsd(Number.POSITIVE_INFINITY)).toThrow(/PARAM-001/);
    expect(() => daoSetLampUsd(0)).toThrow(/PARAM-001/);
    daoSetLampUsd(LAMP_USD_DEFAULT);
  });
  it("a negative daoSetTask field -> TASK-002; valueBps over the cap -> TASK-003", () => {
    expect(() => daoSetTask("x.neg", { baseFeeUsd: -1 })).toThrow(/TASK-002/);
    expect(() => daoSetTask("x.bps", { valueBps: 99999 })).toThrow(/TASK-003/);
  });
});

describe("H-3: feeOil is computed in pure bigint — deterministic and lossless", () => {
  it("a large value (the absolute cap) gives an EXACT feeOil, with no 2^53 drift", () => {
    daoSetTask("x.big", { baseFeeUsd: 1e9, traditionalCostUsd: 1e12, onChain: false, defaultAnchorTier: "no_anchor" });
    const q = quoteFee({ task: "x.big", anchorTier: "no_anchor", demandFactor: 1 });
    // feeUsd is clamped at MAX_FEE_USD_ABSOLUTE=100; lampUsd=0.01 -> feeOil = 100/0.01*1e6 = 1e10 (exact).
    expect(q.feeUsd).toBe(100);
    expect(q.feeOil).toBe(10_000_000_000n);
  });
});

describe("M-2: the absolute USD cap stops the DAO inflating traditionalCost", () => {
  it("an enormous traditionalCost is still capped at 100 USD", () => {
    daoSetTask("x.inflate", { baseFeeUsd: 50, traditionalCostUsd: 1e9, onChain: false, defaultAnchorTier: "immediate" });
    const q = quoteFee({ task: "x.inflate", anchorTier: "immediate" });
    expect(q.feeUsd).toBeLessThanOrEqual(100);
  });
});

describe("L-2: the MIN_FEE_OIL floor stops rounding to zero", () => {
  it("a tiny fee with expensive LAMP gives feeOil = MIN_FEE_OIL, not 0", () => {
    daoSetLampUsd(1e6); // 1 LAMP = 1 million USD, so any small fee would round to zero
    const q = quoteFee({ task: "tree.scan", anchorTier: "no_anchor" });
    expect(q.feeUsd).toBeGreaterThan(0);
    expect(q.feeOil).toBe(1_000n); // MIN_FEE_OIL
    daoSetLampUsd(LAMP_USD_DEFAULT);
  });
});

describe("H-1: DemandController is the server-side source of demand", () => {
  it("update() consumes signals and current() feeds quoteFee", () => {
    const dc = new DemandController(1.0);
    dc.update(100, 50); // demand above supply -> rises
    expect(dc.current()).toBeGreaterThan(1.0);
    const q = quoteFee({ task: "fruit.register", demandFactor: dc.current(), anchorTier: "immediate" });
    expect(q.demandFactor).toBe(Math.round(dc.current() * 1e6) / 1e6);
  });
});
