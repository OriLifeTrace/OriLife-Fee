// OriLife — tham số kinh tế phí, DAO-governed (MagicLamp DAO chỉnh theo mùa vụ).
//
// First-principles (kế thừa + tổng quát hoá field-reid/animal_fee.py sang MỌI tác vụ):
//   1. Phí neo vào CHI PHÍ THẬT 4 tài nguyên (storage/compute/bandwidth/anchor), không
//      đặt tuỳ tiện → người dùng trả đúng chi phí + phần nhỏ giao thức.
//   2. Phí value-based cho tác vụ trên tài sản giá trị (cây/quả/vật nuôi): cộng thêm theo
//      giá trị khai báo, có SÀN chống khai thấp.
//   3. Phí co giãn theo CẦU (demand_factor) — cầu cao thì tăng nhẹ để giảm tải.
//   4. TRẦN cứng: phí ≤ MAX_FRACTION × chi phí truyền thống → luôn rẻ hơn cách cũ.
//
// Mọi hằng số ở đây là PLACEHOLDER mô phỏng (trung hạn cố định). Dài hạn: DAO bỏ phiếu
// chỉnh qua dao_set_*; production lấy LAMP/USD từ oracle Score DEX (TWAP), chưa wire.

/** 1 LAMP = 10^6 oil (đơn vị nhỏ nhất on-chain). Mirror LAMP/protocol-utils OIL_PER_LAMP. */
export const OIL_PER_LAMP = 1_000_000n;

/** Tỉ giá quy đổi mặc định: 1 LAMP = 0.01 USD. Production: oracle TWAP. */
export const LAMP_USD_DEFAULT = 0.01;
/** Biên hợp lệ cho tỉ giá LAMP/USD (chống DAO/oracle đặt giá trị phá hệ — M-1). */
export const LAMP_USD_MIN = 1e-6;
export const LAMP_USD_MAX = 1e6;

/** TRẦN TUYỆT ĐỐI theo USD cho 1 tác vụ — backstop độc lập traditionalCost (M-2).
 *  Cap chính = MAX_FRACTION × traditionalCost; cap này chặn DAO thổi traditionalCost. */
export const MAX_FEE_USD_ABSOLUTE = 100;

/** Sàn phí (oil) cho tác vụ phát sinh chi phí thật — chống feeOil làm tròn về 0 (L-2). */
export const MIN_FEE_OIL = 1_000n; // 0.001 LAMP

/** Phần cắt giao thức (basis points) — về bucket PROTOCOL. 700 = 7%. */
export const PROTOCOL_CUT_BPS = 700n;

/** Tỉ lệ chia phần CÒN LẠI (sau cắt giao thức) cho 4 tài nguyên (bps, tổng = 10000).
 *  storage/compute/bandwidth → bucket LAMPNET_REWARD; anchor → bucket ANCHOR. */
export const RESOURCE_SPLIT_BPS = {
  storage: 4000n,
  compute: 3500n,
  bandwidth: 1500n,
  anchor: 1000n,
} as const;

/** Bậc neo on-chain → hệ số nhân toàn phí (đảm bảo cam kết bất biến đắt hơn). */
export type AnchorTier = "no_anchor" | "batch_daily" | "milestone" | "immediate";
export const ANCHOR_TIER_MULT: Record<AnchorTier, number> = {
  no_anchor: 0.3,
  batch_daily: 1.0,
  milestone: 1.8,
  immediate: 6.0,
};

/** Trần phí = MAX_FRACTION × chi phí truyền thống (đảm bảo luôn rẻ hơn ≥ 50%). */
export const MAX_FRACTION_OF_TRADITIONAL = 0.5;

/** Biên demand_factor (co giãn theo cầu). */
export const DEMAND_FACTOR_MIN = 0.5;
export const DEMAND_FACTOR_MAX = 3.0;
/** Trần đổi mỗi bước EMA (±10%) — chống sốc giá. */
export const DEMAND_STEP_CAP = 0.1;
/** Độ nhạy ánh xạ (ratio−1) → delta. */
export const DEMAND_SENSITIVITY = 0.5;

// ── Tỉ giá LAMP/USD có thể chỉnh (DAO/oracle) ──────────────────────────────
let lampUsd = LAMP_USD_DEFAULT;
export function getLampUsd(): number {
  return lampUsd;
}
/** DAO/oracle cập nhật tỉ giá LAMP/USD. Kẹp trong [LAMP_USD_MIN, LAMP_USD_MAX] (M-1). */
export function daoSetLampUsd(v: number): void {
  if (!Number.isFinite(v) || v <= 0) throw new Error("PARAM-001: lampUsd phải hữu hạn > 0");
  if (v < LAMP_USD_MIN || v > LAMP_USD_MAX) {
    throw new Error(`PARAM-002: lampUsd=${v} ngoài biên [${LAMP_USD_MIN}, ${LAMP_USD_MAX}].`);
  }
  lampUsd = v;
}

/** Kiểm tỉ lệ 4 tài nguyên cộng đúng 10000 bps (M-3) — gọi lúc load + khi DAO chỉnh split. */
export function assertResourceSplitSound(): void {
  const sum = RESOURCE_SPLIT_BPS.storage + RESOURCE_SPLIT_BPS.compute
    + RESOURCE_SPLIT_BPS.bandwidth + RESOURCE_SPLIT_BPS.anchor;
  if (sum !== 10_000n) {
    throw new Error(`PARAM-003: RESOURCE_SPLIT_BPS cộng ${sum} ≠ 10000 — anchor (phần dư) sẽ lệch tỉ lệ.`);
  }
}
assertResourceSplitSound();
