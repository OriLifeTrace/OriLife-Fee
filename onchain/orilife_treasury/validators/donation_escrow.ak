//// Kho tạm giữ phần phí đã trích. Tiền vào đây chỉ có MỘT lối ra: một giao dịch có
//// nộp kho bạc Cardano.
////
//// Vì sao việc này làm được bằng mã chứ không bằng lời hứa: từ kỷ nguyên Conway, thân
//// giao dịch Cardano có một trường `treasury_donation` — số lovelace giao dịch này nộp
//// thẳng vào kho bạc của mạng. Hợp đồng Plutus V3 đọc được trường đó. Nên câu "10% quay
//// về kho bạc" không còn là một quy trình vận hành mà là điều kiện chi tiêu: không nộp
//// thì UTxO này không nhúc nhích được.
////
//// Ai cũng gọi được `Donate`, cố ý. Nếu bắt buộc chữ ký của OriLife thì OriLife biến mất
//// là lời hứa chết theo. Đổi lại phải có SÀN tỉ giá, nếu không người ngoài đổi giá bèo
//// rồi bỏ túi chênh lệch. Sàn do tham số biên dịch đặt ra, và nó fail-closed: tỉ giá 0
//// thì hợp đồng từ chối biên dịch có nghĩa, tỉ giá quá thấp thì kho bạc vẫn nhận đủ sàn.

use aiken/collection/list
use cardano/address.{Script, from_verification_key}
use cardano/assets.{AssetName, PolicyId, quantity_of}
use cardano/transaction.{InlineDatum, Input, Output, OutputReference, Transaction}
use orilife/fixtures.{
  carp_name, carp_policy, escrow_hash, inline, input_from, operator_key, ref_at,
  script_output, tx, value_with_carp, wallet_output,
}
use orilife/math.{ceil_div}
use orilife/types.{Donate, EscrowDatum, EscrowRedeemer}

/// Một CARP = 10⁹ đơn vị nhỏ nhất (`nanothread`). Tỉ giá sàn khai theo "lovelace cho
/// mỗi 10⁹ đơn vị", tức lovelace cho mỗi 1 CARP nguyên.
const carp_scale: Int = 1_000_000_000

validator donation_escrow(
  carp_policy: PolicyId,
  carp_name: AssetName,
  /// Sàn tỉ giá: mỗi 1 CARP rời kho tạm phải kéo theo ít nhất ngần này lovelace nộp
  /// kho bạc. Đây là con số quản trị, không phải giá thị trường — nó chỉ chặn đáy.
  min_lovelace_per_carp: Int,
) {
  spend(
    datum: Option<EscrowDatum>,
    _redeemer: EscrowRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(EscrowDatum { carp: declared }) = datum
    expect Some(own_input) = find_input(tx.inputs, own_ref)
    expect Script(own_hash) = own_input.output.address.payment_credential

    // Chỉ cho tiêu MỘT UTxO kho tạm mỗi giao dịch. Không có câu này thì hai UTxO cùng
    // trỏ vào một khoản nộp kho bạc và một nửa số CARP rời kho không kèm đồng nào.
    let own_inputs =
      list.filter(
        tx.inputs,
        fn(input) { input.output.address.payment_credential == Script(own_hash) },
      )

    // Giá trị thật đang nằm ở đây. Không tin `declared`, chỉ dùng nó để bắt lời khai lệch.
    let held = quantity_of(own_input.output.value, carp_policy, carp_name)

    // Phần trả lại kho tạm (cho phép nộp làm nhiều đợt thay vì một cục).
    let continuing =
      list.filter(
        tx.outputs,
        fn(output) { output.address.payment_credential == Script(own_hash) },
      )
    let returned = sum_carp(continuing, carp_policy, carp_name)
    let released = held - returned

    // Kho bạc phải nhận đủ sàn cho đúng phần rời đi. Làm tròn LÊN.
    let required = ceil_div(released * min_lovelace_per_carp, carp_scale)

    and {
      list.length(own_inputs) == 1,
      declared == held,
      released > 0,
      min_lovelace_per_carp > 0,
      donation_at_least(tx, required),
      continuing_datums_honest(continuing, carp_policy, carp_name),
    }
  }

  else(_) {
    fail
  }
}

fn find_input(inputs: List<Input>, own_ref: OutputReference) -> Option<Input> {
  list.find(inputs, fn(input) { input.output_reference == own_ref })
}

fn sum_carp(outputs: List<Output>, policy: PolicyId, name: AssetName) -> Int {
  list.foldl(
    outputs,
    0,
    fn(output, acc) { acc + quantity_of(output.value, policy, name) },
  )
}

/// Mỗi UTxO trả lại kho tạm phải khai đúng số nó giữ. Bỏ câu này thì một lần nộp có thể
/// để lại một UTxO khai 0 trong khi giữ đầy CARP, và lần sau nó rời kho không tốn gì.
fn continuing_datums_honest(
  outputs: List<Output>,
  policy: PolicyId,
  name: AssetName,
) -> Bool {
  list.all(
    outputs,
    fn(output) {
      when output.datum is {
        InlineDatum(raw) -> {
          expect EscrowDatum { carp } : EscrowDatum = raw
          carp == quantity_of(output.value, policy, name)
        }
        _ -> False
      }
    },
  )
}

fn donation_at_least(tx: Transaction, required: Int) -> Bool {
  when tx.treasury_donation is {
    Some(donated) -> donated >= required
    None -> False
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bài kiểm.
// ─────────────────────────────────────────────────────────────────────────────

/// Sàn dùng trong bài kiểm: mỗi 1 CARP kéo theo tối thiểu 500 lovelace.
const test_rate: Int = 500

/// Một CARP nguyên, tính bằng đơn vị nhỏ nhất.
const carp_one: Int = 1_000_000_000

/// 1000 CARP nguyên. Bài kiểm đầu tiên viết bằng số trần (1_000) đã sai đơn vị và
/// bài kiểm bắt được: 1_000 đơn vị nhỏ nhất là một PHẦN TRIỆU của một CARP, nên sàn
/// tỉ giá làm tròn về gần 0 và mọi phép so sàn đều qua. Giữ lại ghi chú này vì đó
/// đúng là loại lỗi mà một bài kiểm "chạy là xanh" sẽ nuốt mất.
const thousand_carp: Int = 1_000 * carp_one

fn run(declared: Int, tx_body: Transaction) -> Bool {
  donation_escrow.spend(
    carp_policy,
    carp_name,
    test_rate,
    Some(EscrowDatum { carp: declared }),
    Donate,
    ref_at(0),
    tx_body,
  )
}

fn escrow_utxo(lovelace: Int, carp: Int) -> Output {
  script_output(
    escrow_hash,
    value_with_carp(lovelace, carp),
    inline(EscrowDatum { carp }),
  )
}

/// 1000 CARP × 500 = 500_000 lovelace phải vào kho bạc. Nộp đúng ngần đó thì qua.
test donate_passes_when_the_treasury_gets_the_floor() {
  run(
    thousand_carp,
    tx(
      [input_from(ref_at(0), escrow_utxo(2_000_000, thousand_carp))],
      [
        wallet_output(
          from_verification_key(operator_key),
          value_with_carp(2_000_000, thousand_carp),
        ),
      ],
      [],
      Some(500_000),
    ),
  )
}

/// Nộp DƯ vẫn qua. Sàn là sàn, không phải giá cố định — thị trường tốt hơn sàn thì
/// kho bạc hưởng phần tốt hơn.
test donate_passes_when_the_treasury_gets_more() {
  run(
    thousand_carp,
    tx(
      [input_from(ref_at(0), escrow_utxo(2_000_000, thousand_carp))],
      [
        wallet_output(
          from_verification_key(operator_key),
          value_with_carp(2_000_000, thousand_carp),
        ),
      ],
      [],
      Some(900_000),
    ),
  )
}

/// Không có trường nộp kho bạc thì UTxO không nhúc nhích. Đây là cả cơ chế gói trong
/// một bài kiểm: lời hứa không phải quy trình, nó là điều kiện chi tiêu.
test donate_fails_without_a_donation() {
  !run(
    thousand_carp,
    tx(
      [input_from(ref_at(0), escrow_utxo(2_000_000, thousand_carp))],
      [
        wallet_output(
          from_verification_key(operator_key),
          value_with_carp(2_000_000, thousand_carp),
        ),
      ],
      [],
      None,
    ),
  )
}

/// Thiếu một lovelace so với sàn cũng hỏng.
test donate_fails_one_lovelace_below_the_floor() {
  !run(
    thousand_carp,
    tx(
      [input_from(ref_at(0), escrow_utxo(2_000_000, thousand_carp))],
      [
        wallet_output(
          from_verification_key(operator_key),
          value_with_carp(2_000_000, thousand_carp),
        ),
      ],
      [],
      Some(499_999),
    ),
  )
}

/// Nộp làm nhiều đợt: 400 rời kho tạm, 600 quay lại. Chỉ phải nộp cho 400.
test donate_allows_a_partial_release() {
  run(
    thousand_carp,
    tx(
      [input_from(ref_at(0), escrow_utxo(2_000_000, thousand_carp))],
      [
        escrow_utxo(2_000_000, 600 * carp_one),
        wallet_output(
          from_verification_key(operator_key),
          value_with_carp(2_000_000, 400 * carp_one),
        ),
      ],
      [],
      Some(200_000),
    ),
  )
}

/// Phần quay lại kho tạm phải khai đúng số nó giữ. Khai 0 mà giữ 600 thì lần sau 600
/// đó rời kho không tốn một đồng nào — đường rút ruột gọn nhất, nên có bài kiểm riêng.
test partial_release_rejects_a_lying_remainder() {
  !run(
    thousand_carp,
    tx(
      [input_from(ref_at(0), escrow_utxo(2_000_000, thousand_carp))],
      [
        script_output(
          escrow_hash,
          value_with_carp(2_000_000, 600 * carp_one),
          inline(EscrowDatum { carp: 0 }),
        ),
        wallet_output(
          from_verification_key(operator_key),
          value_with_carp(2_000_000, 400 * carp_one),
        ),
      ],
      [],
      Some(200_000),
    ),
  )
}

/// Làm tròn nghiêng về kho bạc. 3 CARP × 500 / 1000 = 1,5 lovelace ⟹ phải nộp 2,
/// không phải 1. Một đơn vị nghe không đáng kể, nhưng chiều của phép làm tròn thì
/// đáng kể: nó lặp lại ở mọi giao dịch.
test rounding_favours_the_treasury() {
  let big_scale_rate = 500
  expect ceil_div(3 * big_scale_rate, 1_000_000_000) == 1
  expect ceil_div(1_000_000_000 * 3 + 1, 1_000_000_000) == 4
  True
}

/// Lời khai trong datum phải khớp giá trị thật đang giữ.
test escrow_rejects_a_datum_that_lies_about_its_holdings() {
  !run(
    9_999,
    tx(
      [input_from(ref_at(0), escrow_utxo(2_000_000, thousand_carp))],
      [
        wallet_output(
          from_verification_key(operator_key),
          value_with_carp(2_000_000, thousand_carp),
        ),
      ],
      [],
      Some(5_000_000),
    ),
  )
}

/// Hai UTxO kho tạm trong một giao dịch bị chặn: nếu cho qua thì MỘT khoản nộp thoả
/// điều kiện cho CẢ HAI, và một nửa số CARP rời kho không kèm đồng nào.
test escrow_rejects_two_escrow_inputs() {
  !run(
    thousand_carp,
    tx(
      [
        input_from(ref_at(0), escrow_utxo(2_000_000, thousand_carp)),
        input_from(ref_at(1), escrow_utxo(2_000_000, thousand_carp)),
      ],
      [
        wallet_output(
          from_verification_key(operator_key),
          value_with_carp(4_000_000, 2 * thousand_carp),
        ),
      ],
      [],
      Some(500_000),
    ),
  )
}

/// Không rời đồng nào mà vẫn tiêu UTxO thì hỏng — nếu không, ai cũng khuấy kho tạm
/// vô hạn lần với khoản nộp bằng 0.
test escrow_rejects_a_no_op_spend() {
  !run(
    thousand_carp,
    tx(
      [input_from(ref_at(0), escrow_utxo(2_000_000, thousand_carp))],
      [escrow_utxo(2_000_000, thousand_carp)],
      [],
      Some(500_000),
    ),
  )
}
