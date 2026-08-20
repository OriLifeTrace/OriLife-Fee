// OriLife — phân loại BUCKET treasury (category id trong sổ CustodyDatum).
//
// "Các treasury" ở đây = các BUCKET kế toán bên trong MỘT custody
// instance OriLife (sổ ledger đa-asset × bucket — xem LAMP/Treasury types.ak). Một
// giao dịch Collect duy nhất nạp LAMP vào nhiều bucket bằng nhiều CollectItem khác
// `category`. Tách bucket theo MỤC ĐÍCH dòng tiền, không theo người trả:
//
//   PROTOCOL       — phần cắt giao thức MagicLamp (vận hành orchestrator, kho bạc DAO).
//   LAMPNET_REWARD — phần trả người đóng góp phần cứng LampNet (storage/compute/bandwidth).
//                    Giữ ở đây dạng kế toán; node redeem sau qua Release + vesting
//                    (LampNet Reward-Feat §3 Capped Drop). KHÔNG trả thẳng trong tx phí.
//   ANCHOR         — quỹ bù chi phí neo on-chain Cardano (min-UTxO + tx fee batch MMR).
//
// Bất biến: tổng LAMP của 3 bucket = đúng phí người dùng trả (Σ bucket = fee_total_oil).
// LAMP fixed-supply: khoản vào treasury là CHUYỂN TRẠNG THÁI circulating→accounting,
// KHÔNG đốt (Σout=Σin per-asset, ép bởi custody.ak C-COL-4).

/** Id bucket (category) — khớp sổ ledger CustodyDatum. Số nguyên, DAO có thể mở thêm. */
export const BUCKET = {
  PROTOCOL: 0n,
  LAMPNET_REWARD: 1n,
  ANCHOR: 2n,
} as const;

export type BucketName = keyof typeof BUCKET;

/** Nhãn người-đọc cho từng bucket (log/giải thích, không vào on-chain). */
export const BUCKET_LABEL: Record<BucketName, string> = {
  PROTOCOL: "Kho bạc giao thức MagicLamp (protocol cut)",
  LAMPNET_REWARD: "Quỹ thưởng node LampNet (storage/compute/bandwidth)",
  ANCHOR: "Quỹ neo on-chain Cardano (anchor)",
};

/** Tra category (bigint) từ tên bucket. */
export function bucketCategory(name: BucketName): bigint {
  return BUCKET[name];
}
