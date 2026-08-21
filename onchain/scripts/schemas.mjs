// Khuôn datum, tách riêng khỏi kịch bản. Để chung với kịch bản thì `import` kéo theo
// cả phần thân chạy của kịch bản đó — đã vấp một lần.

import { Data } from "@lucid-evolution/lucid";

export const VaultDatum = Data.Object({
  collected: Data.Integer(),
  skimmed: Data.Integer(),
});

/// `OutputReference` của stdlib: `Constr 0 [transaction_id, output_index]`.
export const OutputReference = Data.Object({
  transaction_id: Data.Bytes(),
  output_index: Data.Integer(),
});

/// Kho tạm. Ba trường, và hai trường sau là phần VÁ — đọc đầu `donation_escrow.ak`
/// trước khi đổi bất cứ thứ gì ở đây.
///
///   `vault`  — băm kho phí đã trích khoản này ra. Chặn hai instance kho phí dùng
///              chung MỘT khoản trích.
///   `parent` — `null` là khoản vừa trích sang; `{transaction_id, output_index}` là
///              phần dư của đúng ô đó. Kho tạm đo phần đã rời đi bằng `giữ − trả_lại`,
///              và không có trường này thì một khoản MỚI gửi vào trong cùng giao dịch
///              bị đếm nhầm thành `trả_lại`.
///
/// `Data.Nullable` sinh đúng `Constr 0 [v]` / `Constr 1 []`, khớp `Option` của Aiken
/// (đã đối chiếu: `null` ra `d87a80`).
export const EscrowDatum = Data.Object({
  carp: Data.Integer(),
  vault: Data.Bytes(),
  parent: Data.Nullable(OutputReference),
});

/// Redeemer của kho phí: Collect{amount} · Skim{amount} · Operate · Close
///
/// Thứ tự PHẢI khớp thứ tự khai trong `types.ak` — chỉ số constructor là thứ đi lên
/// chuỗi, tên thì không. Thêm nhánh vào giữa là đổi nghĩa của mọi redeemer đã ký.
export const VaultRedeemer = Data.Enum([
  Data.Object({ Collect: Data.Object({ amount: Data.Integer() }) }),
  Data.Object({ Skim: Data.Object({ amount: Data.Integer() }) }),
  Data.Literal("Operate"),
  Data.Literal("Close"),
]);

export const EscrowRedeemer = Data.Enum([Data.Literal("Donate")]);
