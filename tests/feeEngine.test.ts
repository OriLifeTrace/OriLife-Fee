import { describe, it, expect, beforeEach } from "vitest";
import {
  quoteFee, splitOil, demandFactorFromSignals, DemandController,
} from "../src/feeEngine.js";
import { taskKeys, daoSetTask, getTask } from "../src/tasks.js";
import { daoSetLampUsd, LAMP_USD_DEFAULT, OIL_PER_LAMP } from "../src/params.js";

beforeEach(() => {
  daoSetLampUsd(LAMP_USD_DEFAULT); // reset tỉ giá giữa các test
});

describe("splitOil — bảo toàn tuyệt đối Σ bucket == feeOil", () => {
  // Quét nhiều giá trị (kể cả số lẻ, nhỏ, lớn) → anchor hấp thụ dư, không hụt 1 oil.
  const samples = [0n, 1n, 2n, 3n, 7n, 99n, 100n, 101n, 999_999n, 1_000_000n, 1_234_567n, 10n ** 12n + 7n];
  for (const v of samples) {
    it(`feeOil=${v}: protocol+lampnet+anchor == feeOil`, () => {
      const s = splitOil(v);
      expect(s.protocolOil + s.lampnetOil + s.anchorOil).toBe(v);
      expect(s.lampnetOil).toBe(s.storageOil + s.computeOil + s.bandwidthOil);
      // không âm
      for (const x of [s.protocolOil, s.lampnetOil, s.anchorOil]) expect(x >= 0n).toBe(true);
    });
  }
});

describe("quoteFee — bảo toàn Σ bucket cho MỌI tác vụ", () => {
  for (const key of taskKeys()) {
    it(`${key}: Σ bucket.oil == feeOil`, () => {
      const q = quoteFee({ task: key, declaredValueUsd: 1000, lifecycleEvents: 3 });
      const sum = q.buckets.reduce((a, b) => a + b.oil, 0n);
      expect(sum).toBe(q.feeOil);
      expect(q.buckets).toHaveLength(3);
    });
  }
});

describe("quoteFee — TRẦN: phí ≤ 50% truyền thống", () => {
  it("giá trị rất cao vẫn bị cap, advantagePct ≥ 50", () => {
    const q = quoteFee({ task: "animal.enroll", declaredValueUsd: 1_000_000, anchorTier: "immediate" });
    const t = getTask("animal.enroll");
    expect(q.feeUsd).toBeLessThanOrEqual(t.traditionalCostUsd * 0.5 + 1e-9);
    expect(q.capped).toBe(true);
    expect(q.advantagePct).toBeGreaterThanOrEqual(50);
  });
});

describe("quoteFee — bậc neo nhân phí đơn điệu (tác vụ off-chain, tier tự do)", () => {
  it("immediate > milestone > batch_daily > no_anchor (tree.scan off-chain, chưa cap)", () => {
    const mk = (tier: "no_anchor" | "batch_daily" | "milestone" | "immediate") =>
      quoteFee({ task: "tree.scan", anchorTier: tier, declaredValueUsd: 0 }).feeUsd;
    const no = mk("no_anchor"), bd = mk("batch_daily"), ms = mk("milestone"), im = mk("immediate");
    expect(no).toBeLessThan(bd);
    expect(bd).toBeLessThan(ms);
    expect(ms).toBeLessThanOrEqual(im);
  });
});

describe("quoteFee — L-1: tác vụ on-chain KHÔNG hạ tier dưới mặc định", () => {
  it("fruit.register (default batch_daily) yêu cầu no_anchor → bị nâng lên batch_daily", () => {
    const asked = quoteFee({ task: "fruit.register", anchorTier: "no_anchor" });
    const def = quoteFee({ task: "fruit.register", anchorTier: "batch_daily" });
    expect(asked.anchorTier).toBe("batch_daily");
    expect(asked.feeUsd).toBe(def.feeUsd);
  });
  it("vẫn cho NÂNG tier (immediate) trên tác vụ on-chain", () => {
    const im = quoteFee({ task: "fruit.register", anchorTier: "immediate" });
    expect(im.anchorTier).toBe("immediate");
  });
  it("tác vụ off-chain (tree.scan) cho hạ tier tự do", () => {
    expect(quoteFee({ task: "tree.scan", anchorTier: "no_anchor" }).anchorTier).toBe("no_anchor");
  });
});

describe("quoteFee — value-based dùng SÀN khi khai thấp", () => {
  it("khai dưới sàn → tính theo sàn (chống under-declaration)", () => {
    const low = quoteFee({ task: "animal.enroll", declaredValueUsd: 1, anchorTier: "no_anchor" });
    const atFloor = quoteFee({ task: "animal.enroll", declaredValueUsd: 400, anchorTier: "no_anchor" });
    expect(low.feeUsd).toBe(atFloor.feeUsd); // floorValueUsd = 400
  });
  it("tác vụ valueBps=0 KHÔNG đổi theo declaredValue", () => {
    const a = quoteFee({ task: "tree.scan", declaredValueUsd: 0 }).feeUsd;
    const b = quoteFee({ task: "tree.scan", declaredValueUsd: 999999 }).feeUsd;
    expect(a).toBe(b);
  });
});

describe("demandFactorFromSignals — clamp + hướng đúng", () => {
  it("cầu > cung → tăng (bound ≤ 3.0)", () => {
    const next = demandFactorFromSignals(1.0, 100, 50);
    expect(next).toBeGreaterThan(1.0);
    expect(next).toBeLessThanOrEqual(3.0);
  });
  it("cung > cầu → giảm (bound ≥ 0.5)", () => {
    const next = demandFactorFromSignals(1.0, 10, 100);
    expect(next).toBeLessThan(1.0);
    expect(next).toBeGreaterThanOrEqual(0.5);
  });
  it("magicGenerated=0 → giữ prev (clamp)", () => {
    expect(demandFactorFromSignals(1.0, 5, 0)).toBe(1.0);
  });
  it("mỗi bước đổi ≤ 10%", () => {
    const next = demandFactorFromSignals(2.0, 1_000_000, 1);
    expect(next).toBeLessThanOrEqual(2.0 * 1.1 + 1e-9);
  });
});

describe("quoteFee — demand_factor nhân phí (khi chưa cap)", () => {
  it("demand cao → phí cao hơn", () => {
    const lo = quoteFee({ task: "fruit.register", demandFactor: 0.5, anchorTier: "no_anchor" }).feeUsd;
    const hi = quoteFee({ task: "fruit.register", demandFactor: 2.0, anchorTier: "no_anchor" }).feeUsd;
    expect(hi).toBeGreaterThan(lo);
  });
});

describe("quoteFee — tỉ giá LAMP/USD ảnh hưởng oil", () => {
  it("LAMP rẻ hơn (USD/LAMP nhỏ) → cần nhiều oil hơn cho cùng phí USD", () => {
    const base = quoteFee({ task: "tree.register", demandFactor: 1, anchorTier: "no_anchor" });
    daoSetLampUsd(LAMP_USD_DEFAULT / 2); // 1 LAMP = $0.005
    const cheap = quoteFee({ task: "tree.register", demandFactor: 1, anchorTier: "no_anchor" });
    expect(cheap.feeOil).toBeGreaterThan(base.feeOil);
  });
});

describe("getTask — typo khoá ném lỗi", () => {
  it("khoá lạ → lỗi", () => {
    expect(() => quoteFee({ task: "tree.unknown" })).toThrow(/TASK-001/);
  });
});

describe("daoSetTask — DAO ghi đè hồ sơ", () => {
  it("đổi baseFeeUsd có hiệu lực", () => {
    daoSetTask("fruit.qr", { baseFeeUsd: 0.999, traditionalCostUsd: 100 });
    const q = quoteFee({ task: "fruit.qr", anchorTier: "no_anchor" });
    expect(q.feeUsd).toBeGreaterThan(0.2); // tăng rõ so với 0.002 ban đầu
    daoSetTask("fruit.qr", { baseFeeUsd: 0.002, traditionalCostUsd: 0.2 }); // hoàn nguyên
  });
});

describe("đơn vị oil", () => {
  it("OIL_PER_LAMP = 1e6", () => {
    expect(OIL_PER_LAMP).toBe(1_000_000n);
  });
});

describe("M-1: biên DAO setter", () => {
  it("daoSetLampUsd ngoài biên → PARAM-002", () => {
    expect(() => daoSetLampUsd(1e-300)).toThrow(/PARAM-00[12]/);
    expect(() => daoSetLampUsd(1e9)).toThrow(/PARAM-002/);
    daoSetLampUsd(LAMP_USD_DEFAULT);
  });
  it("daoSetLampUsd không hữu hạn → PARAM-001", () => {
    expect(() => daoSetLampUsd(Number.POSITIVE_INFINITY)).toThrow(/PARAM-001/);
    expect(() => daoSetLampUsd(0)).toThrow(/PARAM-001/);
    daoSetLampUsd(LAMP_USD_DEFAULT);
  });
  it("daoSetTask field âm → TASK-002; valueBps vượt trần → TASK-003", () => {
    expect(() => daoSetTask("x.neg", { baseFeeUsd: -1 })).toThrow(/TASK-002/);
    expect(() => daoSetTask("x.bps", { valueBps: 99999 })).toThrow(/TASK-003/);
  });
});

describe("H-3: feeOil tính bigint thuần — tất định + không mất chính xác", () => {
  it("giá trị lớn (cap tuyệt đối) cho feeOil CHÍNH XÁC, không lệch 2^53", () => {
    daoSetTask("x.big", { baseFeeUsd: 1e9, traditionalCostUsd: 1e12, onChain: false, defaultAnchorTier: "no_anchor" });
    const q = quoteFee({ task: "x.big", anchorTier: "no_anchor", demandFactor: 1 });
    // feeUsd kẹp ở MAX_FEE_USD_ABSOLUTE=100; lampUsd=0.01 → feeOil = 100/0.01×1e6 = 1e10 (exact).
    expect(q.feeUsd).toBe(100);
    expect(q.feeOil).toBe(10_000_000_000n);
  });
});

describe("M-2: trần tuyệt đối USD chặn DAO thổi traditionalCost", () => {
  it("traditionalCost khổng lồ vẫn bị cap ≤ 100 USD", () => {
    daoSetTask("x.inflate", { baseFeeUsd: 50, traditionalCostUsd: 1e9, onChain: false, defaultAnchorTier: "immediate" });
    const q = quoteFee({ task: "x.inflate", anchorTier: "immediate" });
    expect(q.feeUsd).toBeLessThanOrEqual(100);
  });
});

describe("L-2: sàn MIN_FEE_OIL chống làm tròn về 0", () => {
  it("phí cực nhỏ + LAMP đắt → feeOil = MIN_FEE_OIL (không 0)", () => {
    daoSetLampUsd(1e6); // 1 LAMP = 1 triệu USD → mọi phí nhỏ làm tròn về 0
    const q = quoteFee({ task: "tree.scan", anchorTier: "no_anchor" });
    expect(q.feeUsd).toBeGreaterThan(0);
    expect(q.feeOil).toBe(1_000n); // MIN_FEE_OIL
    daoSetLampUsd(LAMP_USD_DEFAULT);
  });
});

describe("H-1: DemandController là nguồn demand server-side", () => {
  it("update theo tín hiệu, current() đưa vào quoteFee", () => {
    const dc = new DemandController(1.0);
    dc.update(100, 50); // cầu > cung → tăng
    expect(dc.current()).toBeGreaterThan(1.0);
    const q = quoteFee({ task: "fruit.register", demandFactor: dc.current(), anchorTier: "immediate" });
    expect(q.demandFactor).toBe(Math.round(dc.current() * 1e6) / 1e6);
  });
});
