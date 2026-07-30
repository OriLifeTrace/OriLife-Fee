// OriLife — danh mục TÁC VỤ người dùng chịu phí + hồ sơ kinh tế từng tác vụ.
//
// Nguồn tác vụ: orilife-core API (tree/fruit/evidence/farm) + field-reid (animal).
// Mỗi tác vụ có hồ sơ định giá DAO-governed. value_bps>0 = tác vụ trên tài sản giá trị
// (cộng phí theo giá trị khai báo, có SÀN chống khai thấp). on_chain = có phát sinh neo.

import type { AnchorTier } from "./params.js";

export interface TaskSpec {
  /** Khoá tác vụ — định danh ổn định (dùng cho app_id phụ + log). */
  key: string;
  /** Mô tả ngắn (người đọc). */
  label: string;
  /** Phí cơ sở (USD) cho tác vụ. */
  baseFeeUsd: number;
  /** Chi phí truyền thống tương ứng (USD) — dùng tính TRẦN + lợi thế %. */
  traditionalCostUsd: number;
  /** Basis points cộng theo giá trị tài sản khai báo (0 = không value-based). */
  valueBps: number;
  /** SÀN giá trị (USD) chống khai thấp; 0 nếu không value-based. */
  floorValueUsd: number;
  /** Bậc neo mặc định khi caller không chỉ định. */
  defaultAnchorTier: AnchorTier;
  /** Có phát sinh neo on-chain trực tiếp (true) hay chỉ off-chain + batch (false). */
  onChain: boolean;
}

/** Danh mục tác vụ (PLACEHOLDER mô phỏng — DAO chỉnh qua daoSetTask). */
const CATALOG: Record<string, TaskSpec> = {
  "tree.register": {
    key: "tree.register", label: "Đăng ký cây",
    baseFeeUsd: 0.02, traditionalCostUsd: 1.5, valueBps: 2, floorValueUsd: 50,
    defaultAnchorTier: "batch_daily", onChain: true,
  },
  "tree.scan": {
    key: "tree.scan", label: "Quét định danh cây (verify)",
    baseFeeUsd: 0.004, traditionalCostUsd: 0.3, valueBps: 0, floorValueUsd: 0,
    defaultAnchorTier: "no_anchor", onChain: false,
  },
  "tree.anchor": {
    key: "tree.anchor", label: "Neo cây lên Cardano (NFT CIP-68)",
    baseFeeUsd: 0.05, traditionalCostUsd: 2.0, valueBps: 3, floorValueUsd: 100,
    defaultAnchorTier: "immediate", onChain: true,
  },
  "fruit.register": {
    key: "fruit.register", label: "Đăng ký quả",
    baseFeeUsd: 0.01, traditionalCostUsd: 0.5, valueBps: 1, floorValueUsd: 5,
    defaultAnchorTier: "batch_daily", onChain: true,
  },
  "fruit.lifecycle": {
    key: "fruit.lifecycle", label: "Ghi sự kiện vòng đời quả",
    baseFeeUsd: 0.006, traditionalCostUsd: 0.4, valueBps: 0, floorValueUsd: 0,
    defaultAnchorTier: "batch_daily", onChain: true,
  },
  "fruit.qr": {
    key: "fruit.qr", label: "Sinh QR truy xuất quả",
    baseFeeUsd: 0.002, traditionalCostUsd: 0.2, valueBps: 0, floorValueUsd: 0,
    defaultAnchorTier: "no_anchor", onChain: false,
  },
  "animal.enroll": {
    key: "animal.enroll", label: "Đăng ký sinh vật",
    baseFeeUsd: 0.05, traditionalCostUsd: 3.0, valueBps: 1, floorValueUsd: 400,
    defaultAnchorTier: "batch_daily", onChain: true,
  },
  "animal.identify": {
    key: "animal.identify", label: "Quét định danh sinh vật",
    baseFeeUsd: 0.008, traditionalCostUsd: 0.5, valueBps: 0, floorValueUsd: 0,
    defaultAnchorTier: "no_anchor", onChain: false,
  },
  "evidence.ingest": {
    key: "evidence.ingest", label: "Ghi nhận ảnh chứng cứ",
    baseFeeUsd: 0.01, traditionalCostUsd: 0.6, valueBps: 0, floorValueUsd: 0,
    defaultAnchorTier: "batch_daily", onChain: false,
  },
};

/** Danh sách khoá tác vụ hiện có. */
export function taskKeys(): string[] {
  return Object.keys(CATALOG);
}

/** Lấy hồ sơ tác vụ; ném lỗi nếu không có (chống typo khoá). */
export function getTask(key: string): TaskSpec {
  const t = CATALOG[key];
  if (!t) {
    throw new Error(`TASK-001: tác vụ '${key}' không có trong danh mục. Có: ${taskKeys().join(", ")}`);
  }
  return t;
}

/** Trần valueBps DAO được đặt (chống thổi phí value-based). */
export const MAX_VALUE_BPS = 1000; // ≤ 10% giá trị tài sản

/** DAO cập nhật/ghi đè hồ sơ tác vụ (bỏ phiếu theo mùa). Kiểm biên chống nhập sai/độc (M-1). */
export function daoSetTask(key: string, patch: Partial<Omit<TaskSpec, "key">>): void {
  const cur = CATALOG[key] ?? {
    key, label: key, baseFeeUsd: 0, traditionalCostUsd: 0,
    valueBps: 0, floorValueUsd: 0, defaultAnchorTier: "batch_daily" as AnchorTier, onChain: false,
  };
  const next: TaskSpec = { ...cur, ...patch, key };

  // Biên: số không âm + hữu hạn; valueBps trong [0, MAX_VALUE_BPS].
  for (const [f, v] of [
    ["baseFeeUsd", next.baseFeeUsd], ["traditionalCostUsd", next.traditionalCostUsd],
    ["floorValueUsd", next.floorValueUsd], ["valueBps", next.valueBps],
  ] as const) {
    if (!Number.isFinite(v) || v < 0) throw new Error(`TASK-002: ${key}.${f} phải hữu hạn ≥ 0 (gặp ${v}).`);
  }
  if (next.valueBps > MAX_VALUE_BPS) {
    throw new Error(`TASK-003: ${key}.valueBps=${next.valueBps} vượt trần ${MAX_VALUE_BPS}.`);
  }
  CATALOG[key] = next;
}
