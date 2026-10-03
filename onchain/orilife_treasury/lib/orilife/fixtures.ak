//// Bộ dựng giao dịch giả cho bài kiểm. Tách riêng để bài kiểm chỉ nói về LUẬT,
//// không lẫn với việc lắp ráp dữ liệu.

use aiken/interval
use cardano/address.{Address, from_script, with_delegation_key}
use cardano/assets.{AssetName, PolicyId, Value, add, from_lovelace}
use cardano/transaction.{
  Datum, InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
  placeholder,
}
use orilife/types.{EscrowDatum, vault_nft_name}

pub const carp_policy: PolicyId =
  #"11111111111111111111111111111111111111111111111111111111"

pub const carp_name: AssetName = #"43415250"

pub const vault_hash: ByteArray =
  #"22222222222222222222222222222222222222222222222222222222"

pub const escrow_hash: ByteArray =
  #"33333333333333333333333333333333333333333333333333333333"

pub const operator_key: ByteArray =
  #"44444444444444444444444444444444444444444444444444444444"

pub const stranger_key: ByteArray =
  #"55555555555555555555555555555555555555555555555555555555"

pub const inbox_hash: ByteArray =
  #"66666666666666666666666666666666666666666666666666666666"

/// UTxO ví bị tiêu khi mở kho. Khác mã giao dịch với `ref_at` để không trùng ô nào khác.
pub const seed_ref: OutputReference =
  OutputReference {
    transaction_id: #"bb00000000000000000000000000000000000000000000000000000000000000",
    output_index: 0,
  }

/// Cận dưới khoảng hiệu lực mặc định của mọi giao dịch giả (POSIX ms).
pub const now_ms: Int = 1_760_000_000_000

/// Độ rộng khoảng hiệu lực mặc định. Cận trên = `now_ms + tx_window_ms`.
pub const tx_window_ms: Int = 60_000

/// 10% — con số của chính sách, cố định trong mọi bài kiểm dưới đây.
pub const skim_bps: Int = 1_000

/// Giá trị gồm ADA giữ chỗ và một lượng CARP.
pub fn value_with_carp(lovelace: Int, carp: Int) -> Value {
  from_lovelace(lovelace) |> add(carp_policy, carp_name, carp)
}

/// Thêm NFT sổ của kho phí (policy = băm kho phí) vào một giá trị.
pub fn with_vault_nft(value: Value) -> Value {
  add(value, vault_hash, vault_nft_name, 1)
}

pub fn script_output(hash: ByteArray, value: Value, datum: Datum) -> Output {
  Output { address: from_script(hash), value, datum, reference_script: None }
}

pub fn wallet_output(address: Address, value: Value) -> Output {
  Output { address, value, datum: NoDatum, reference_script: None }
}

/// Đầu ra ở CÙNG băm script nhưng có thêm phần uỷ quyền trỏ vào một khoá lạ.
///
/// `Address` có hai phần, và hai địa chỉ cùng phần thanh toán mà khác phần uỷ quyền là
/// HAI ĐỊA CHỈ trên chuỗi — cả hai đều chạy đúng validator đó, nên mọi phép so chỉ chạm
/// `payment_credential` không phân biệt nổi chúng. Đây là hình dạng của cuộc tấn công
/// "dời nhà": ô kho vẫn nằm trong script, nhưng `utxosAt(<địa chỉ kho>)` không còn thấy
/// nó, và phần thưởng uỷ quyền trên số ADA giữ chỗ chảy về khoá của kẻ dựng giao dịch.
pub fn rehomed_script_output(
  hash: ByteArray,
  stake_key: ByteArray,
  value: Value,
  datum: Datum,
) -> Output {
  Output {
    address: from_script(hash) |> with_delegation_key(stake_key),
    value,
    datum,
    reference_script: None,
  }
}

pub fn ref_at(index: Int) -> OutputReference {
  OutputReference {
    transaction_id: #"aa00000000000000000000000000000000000000000000000000000000000000",
    output_index: index,
  }
}

pub fn input_from(reference: OutputReference, output: Output) -> Input {
  Input { output_reference: reference, output }
}

/// Khoảng hiệu lực mặc định là `[now_ms, now_ms + tx_window_ms]` — hữu hạn cả hai đầu,
/// vì `donation_escrow` đọc cận dưới làm thời điểm định giá và `Skim` đọc cận trên làm
/// mốc mở phiên đấu giá. Bài nào đo chính khoảng hiệu lực thì tự ghi đè trường này.
pub fn tx(
  inputs: List<Input>,
  outputs: List<Output>,
  signatories: List<ByteArray>,
  donation: Option<Int>,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs,
    outputs,
    extra_signatories: signatories,
    treasury_donation: donation,
    validity_range: interval.between(now_ms, now_ms + tx_window_ms),
  }
}

pub fn inline(data: Data) -> Datum {
  InlineDatum(data)
}

/// Datum kho tạm. `parent = None` là khoản vừa được kho phí trích sang; `parent = Some(ref)`
/// là phần dư của chính ô `ref`. Hai thứ đó KHÁC nhau và hợp đồng phải phân biệt được —
/// gộp chúng lại chính là lỗ đã vá ở bản này. `listed_at` là mốc mở phiên đấu giá.
pub fn escrow_datum(
  carp: Int,
  parent: Option<OutputReference>,
  listed_at: Int,
) -> EscrowDatum {
  EscrowDatum { carp, vault: vault_hash, parent, listed_at }
}
