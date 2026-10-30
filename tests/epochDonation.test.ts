import { describe, expect, it } from "vitest";

// Đường dẫn tới tệp mã cần kiểm; có thể trỏ sang bản khác qua biến môi trường (kiểm đỏ trên mã cũ).
const target = process.env.EPOCH_DONATION_MODULE ?? new URL("../onchain/scripts/08_epoch_donation.mjs", import.meta.url).href;
const mod: any = await import(/* @vite-ignore */ target);

const summary = (epoch: number) => ({ epoch, tx_count: 7, total_lovelace: "30000000", merkle_root: "ab".repeat(32) });

describe("donationMetadata: epoch tất toán = epoch chi − 1", () => {
  it("khớp (321 tất toán, nộp ở epoch 322) thì ra metadata", () => {
    expect(mod.donationMetadata(summary(321), 322)).toBeDefined();
  });
  it("tóm tắt cùng epoch với epoch chi thì ném", () => {
    expect(() => mod.donationMetadata(summary(322), 322)).toThrow(/epoch liền trước/);
  });
  it("tóm tắt epoch tương lai hoặc cũ hơn một epoch thì ném", () => {
    expect(() => mod.donationMetadata(summary(323), 322)).toThrow(/epoch liền trước/);
    expect(() => mod.donationMetadata(summary(320), 322)).toThrow(/epoch liền trước/);
  });
  it("thiếu epoch của cửa sổ chi thì ném (không bỏ qua phép đối chiếu)", () => {
    expect(() => mod.donationMetadata(summary(321))).toThrow(/epoch của cửa sổ chi/);
  });
});
