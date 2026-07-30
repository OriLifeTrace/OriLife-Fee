// OriLife — CẦU NỐI phí → Treasury Collect. Đây là INTERFACE CONTRACT giữa lõi định giá
// OriLife (off-chain) và lớp custody LAMP Treasury (on-chain). Orchestrator giữ phần này.
//
// Quyết định thiết kế (4 trục — ghi để truy vết, KHÔNG hỏi lại):
//   • Định hướng dài hạn: OriLife là integrator ĐẦU TIÊN nạp phí thật về treasury → chứng
//     minh vòng giá trị LAMP cho mọi Cardano team (mục tiêu "làm LAMP có giá trị").
//   • Nguyên bản: builder Collect chỉ giữ `cut = floor(amount × cut_bps/10000)` vào bucket;
//     phần `amount − cut` là residual trả provider. Phí OriLife là phí THẬT (không có
//     provider nhận lại) ⇒ instance OriLife đặt cut_bps = 10000 (100%) ⇒ cut == amount ⇒
//     TOÀN BỘ khoản phí vào treasury, residual = 0. Mỗi bucket = một CollectItem.category.
//   • Tối ưu eUTXO: gộp 3 bucket vào MỘT giao dịch Collect (nhiều item, 1 custody in/out)
//     → 1 UTxO, 1 lần phí mạng (anti-bloat — đúng tinh thần "micro-collect" của Treasury).
//   • Lợi ích người dùng + bền vững: Σ item == fee_oil tuyệt đối (bảo toàn, fixed-supply,
//     không đốt); phần node LampNet giữ ở bucket LAMPNET_REWARD, redeem sau qua Release.

import type { FeeQuote } from "./feeEngine.js";

/** Mirror byte-perfect LAMP/Treasury/offchain/src/types.ts CollectItem (interface
 *  contract). Giữ cục bộ để lõi bridge test được KHÔNG cần repo LAMP; treasuryClient.ts
 *  import bản THẬT của Treasury SDK và kiểm tương thích cấu trúc khi dựng tx. */
export interface CollectItem {
  app_id: string;   // hex — ai trả (OriLife)
  policy: string;   // hex — asset (LAMP policy)
  name: string;     // hex — asset name (LAMP)
  amount: bigint;   // oil đã định giá ở app
  category: bigint; // bucket_id đích cho phần cut
}

/** cut_bps BẮT BUỘC của instance custody OriLife (100% — phí thật, không residual). */
export const ORILIFE_CUT_BPS = 10_000n;

export interface BridgeConfig {
  /** app_id (hex) ghi vào receipt — định danh OriLife. */
  appIdHex: string;
  /** LAMP policy id (hex). */
  lampPolicyHex: string;
  /** LAMP asset name (hex) — thường "4c414d50". */
  lampNameHex: string;
}

/** Mã hoá chuỗi UTF-8 → hex (cho app_id "orilife"). Tự encode, không phụ thuộc lib DOM. */
export function utf8ToHex(s: string): string {
  let hex = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const bytes: number[] =
      cp < 0x80 ? [cp]
      : cp < 0x800 ? [0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)]
      : cp < 0x10000 ? [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)]
      : [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)];
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * FeeQuote → CollectItem[]. Mỗi bucket có oil > 0 thành 1 item (category = bucket).
 * Bỏ qua bucket oil == 0 (không tạo dòng sổ rỗng). amount = oil (cut_bps=10000 ⇒ cut=oil).
 */
export function quoteToCollectItems(quote: FeeQuote, cfg: BridgeConfig): CollectItem[] {
  return quote.buckets
    .filter((b) => b.oil > 0n)
    .map((b) => ({
      app_id: cfg.appIdHex,
      policy: cfg.lampPolicyHex,
      name: cfg.lampNameHex,
      amount: b.oil,
      category: b.category,
    }));
}

/** Tổng oil của lô item (phải == quote.feeOil khi cut_bps=10000). */
export function totalItemOil(items: CollectItem[]): bigint {
  return items.reduce((acc, it) => acc + it.amount, 0n);
}

/**
 * Kiểm bất biến cầu nối TRƯỚC khi dựng tx (fail-fast, không tốn phí mạng):
 *   • instance custody phải cut_bps == 10000 (pure-deposit) — nếu khác, semantics sai.
 *   • Σ item.amount == quote.feeOil (không hụt/dư oil — khớp bảo toàn on-chain).
 *   • mọi amount ≥ 0.
 * Ném lỗi rõ nếu vi phạm.
 */
export function assertBridgeInvariants(
  quote: FeeQuote, items: CollectItem[], custodyCutBps: bigint,
): void {
  if (custodyCutBps !== ORILIFE_CUT_BPS) {
    throw new Error(
      `BRIDGE-001: instance OriLife phải cut_bps=${ORILIFE_CUT_BPS} (100%, pure-deposit), `
        + `gặp ${custodyCutBps}. cut_bps khác ⇒ cut≠amount ⇒ phí không vào đủ treasury.`,
    );
  }
  const sum = totalItemOil(items);
  if (sum !== quote.feeOil) {
    throw new Error(`BRIDGE-002: Σ item (${sum}) ≠ feeOil (${quote.feeOil}) — vi phạm bảo toàn.`);
  }
  if (items.some((it) => it.amount < 0n)) {
    throw new Error("BRIDGE-003: có item amount < 0.");
  }
}
