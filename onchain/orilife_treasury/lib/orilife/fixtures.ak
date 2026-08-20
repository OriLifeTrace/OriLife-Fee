//// Bộ dựng giao dịch giả cho bài kiểm. Tách riêng để bài kiểm chỉ nói về LUẬT,
//// không lẫn với việc lắp ráp dữ liệu.

use aiken/interval
use cardano/address.{Address, from_script}
use cardano/assets.{AssetName, PolicyId, Value, add, from_lovelace}
use cardano/transaction.{
  Datum, InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
  placeholder,
}

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

/// 10% — con số của chính sách, cố định trong mọi bài kiểm dưới đây.
pub const skim_bps: Int = 1_000

/// Giá trị gồm ADA giữ chỗ và một lượng CARP.
pub fn value_with_carp(lovelace: Int, carp: Int) -> Value {
  from_lovelace(lovelace) |> add(carp_policy, carp_name, carp)
}

pub fn script_output(hash: ByteArray, value: Value, datum: Datum) -> Output {
  Output {
    address: from_script(hash),
    value,
    datum,
    reference_script: None,
  }
}

pub fn wallet_output(address: Address, value: Value) -> Output {
  Output { address, value, datum: NoDatum, reference_script: None }
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

pub fn tx(
  inputs: List<Input>,
  outputs: List<Output>,
  signatories: List<ByteArray>,
  donation: Option<Int>,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: inputs,
    outputs: outputs,
    extra_signatories: signatories,
    treasury_donation: donation,
    validity_range: interval.everything,
  }
}

pub fn inline(data: Data) -> Datum {
  InlineDatum(data)
}
