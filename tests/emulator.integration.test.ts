// Test TÍCH HỢP: chạy 1 giao dịch Collect (phí OriLife → 3 bucket treasury) qua validator
// Plutus custody THẬT trong Lucid Emulator. Đây là bằng chứng tự động mỗi `npm test`.
//
// Yêu cầu: vendor/treasury-custody.plutus.json (blueprint tươi). Nếu thiếu → chạy
// Blueprint đã nằm trong vendor/ và KHÔNG được dựng lại (dựng lại là đổi script hash, tức đổi
// địa chỉ custody đã giữ tài sản thật). Test sẽ báo lỗi rõ nếu thiếu.

import { describe, it, expect } from "vitest";
import { runEmulatorCollect, runEmulatorMultiCollect, SEED_ADA } from "../e2e/harness.js";

describe("E2E emulator — phí OriLife nạp LAMP về các bucket treasury qua validator Plutus", () => {
  it("animal.enroll: 1 giao dịch Collect qua validator thật, value + sổ bảo toàn", async () => {
    const r = await runEmulatorCollect({
      task: "animal.enroll", declaredValueUsd: 1000, anchorTier: "immediate", lifecycleEvents: 4,
    });

    // Giao dịch đã submit + confirm (validator chấp nhận).
    expect(r.txHash).toMatch(/^[0-9a-f]{64}$/);

    // Toàn bộ phí (LAMP oil) đã vào custody (cut_bps=10000 ⇒ cut == feeOil).
    expect(r.lampAfter).toBe(r.quote.feeOil);
    expect(r.lampAfter).toBe(r.cutLamp);

    // ADA seed bảo toàn (không drain).
    expect(r.adaAfter).toBe(SEED_ADA);

    // Sổ từng bucket khớp oil quote.
    const get = (cat: bigint) => r.quote.buckets.find((b) => b.category === cat)!.oil;
    expect(r.ledgerAfter.protocol).toBe(get(0n));
    expect(r.ledgerAfter.lampnet).toBe(get(1n));
    expect(r.ledgerAfter.anchor).toBe(get(2n));

    // Bảo toàn tuyệt đối: Σ sổ == feeOil.
    expect(r.ledgerAfter.protocol + r.ledgerAfter.lampnet + r.ledgerAfter.anchor).toBe(r.quote.feeOil);

    // Params instance bảo toàn.
    expect(r.datumAfter.cut_bps).toBe(10_000n);
  }, 60_000);

  it("tree.register (batch_daily): cũng nạp đúng + bảo toàn", async () => {
    const r = await runEmulatorCollect({ task: "tree.register", declaredValueUsd: 500, lifecycleEvents: 2 });
    expect(r.txHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.lampAfter).toBe(r.quote.feeOil);
    expect(r.ledgerAfter.protocol + r.ledgerAfter.lampnet + r.ledgerAfter.anchor).toBe(r.quote.feeOil);
  }, 60_000);

  // B2: 2 Collect nối tiếp trên CÙNG custody → phủ nhánh sổ incremental (cộng dồn dòng cũ)
  // qua validator Plutus thật (test trước chỉ phủ nhánh "thêm dòng mới").
  it("multi-collect: sổ + value cộng dồn đúng qua 2 giao dịch", async () => {
    const q1 = { task: "animal.enroll", declaredValueUsd: 1000, anchorTier: "immediate" as const };
    const q2 = { task: "tree.register", declaredValueUsd: 500, lifecycleEvents: 2 };
    const rs = await runEmulatorMultiCollect([q1, q2]);
    expect(rs).toHaveLength(2);
    const r1 = rs[0]!, r2 = rs[1]!;

    expect(r1.txHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r2.txHash).toMatch(/^[0-9a-f]{64}$/);

    // Sau collect 2: LAMP custody == feeOil1 + feeOil2 (cộng dồn).
    expect(r2.lampAfter).toBe(r1.quote.feeOil + r2.quote.feeOil);

    // Sổ mỗi bucket == oil bucket lần 1 + lần 2 (nhánh cộng dồn dòng cũ).
    const b = (q: typeof r1.quote, c: bigint) => q.buckets.find((x) => x.category === c)!.oil;
    expect(r2.ledgerAfter.protocol).toBe(b(r1.quote, 0n) + b(r2.quote, 0n));
    expect(r2.ledgerAfter.lampnet).toBe(b(r1.quote, 1n) + b(r2.quote, 1n));
    expect(r2.ledgerAfter.anchor).toBe(b(r1.quote, 2n) + b(r2.quote, 2n));

    // Bảo toàn tổng.
    expect(r2.ledgerAfter.protocol + r2.ledgerAfter.lampnet + r2.ledgerAfter.anchor)
      .toBe(r1.quote.feeOil + r2.quote.feeOil);
  }, 90_000);
});
