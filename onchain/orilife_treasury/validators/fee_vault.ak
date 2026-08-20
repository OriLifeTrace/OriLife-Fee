//// Kho phí OriLife. Phí dịch vụ chảy vào đây bằng CARP; một phần cố định của tổng
//// dòng vào là NGHĨA VỤ phải chuyển sang kho tạm để đổi ADA nộp kho bạc Cardano.
////
//// Ba câu bất biến, và ai cũng đọc được chúng trực tiếp từ UTxO:
////   1. `collected` chỉ tăng, và tăng đúng bằng lượng CARP thật sự chảy vào.
////   2. `skimmed` chỉ tăng, và không bao giờ vượt nghĩa vụ tính trên `collected`.
////   3. Tiêu vận hành không được chạm vào phần nghĩa vụ còn nợ.
////
//// Câu 3 là chỗ chịu lực. Hai câu đầu chỉ là kế toán; nếu thiếu câu 3 thì kế toán đúng
//// mà tiền vẫn đi hết. Nói cách khác: cơ chế không bảo đảm "sẽ nộp", nó bảo đảm
//// "không tiêu được phần phải nộp" — và đó là thứ mạnh hơn một lời hứa.

use aiken/collection/list
use cardano/address.{Script, from_verification_key}
use cardano/assets.{AssetName, PolicyId, lovelace_of, quantity_of}
use cardano/transaction.{InlineDatum, Input, Output, OutputReference, Transaction}
use orilife/fixtures.{
  carp_name, carp_policy, escrow_hash, inline, input_from, operator_key, ref_at,
  script_output, skim_bps, stranger_key, tx, value_with_carp, vault_hash,
  wallet_output,
}
use orilife/math.{floor_div}
use orilife/types.{
  Collect, EscrowDatum, Operate, Skim, VaultDatum, VaultRedeemer,
}

/// Điểm cơ bản: 10000 = 100%.
const bps_scale: Int = 10_000

validator fee_vault(
  carp_policy: PolicyId,
  carp_name: AssetName,
  /// Phần trăm dòng vào phải nộp lại kho bạc, tính bằng điểm cơ bản. 1000 = 10%.
  skim_bps: Int,
  /// Băm hợp đồng kho tạm. Phần trích chỉ được đi về đúng một địa chỉ này.
  escrow_hash: ByteArray,
  /// Khoá vận hành OriLife. Chỉ cần cho `Operate`; nộp phí thì ai cũng nộp được.
  operator_key: ByteArray,
) {
  spend(
    datum: Option<VaultDatum>,
    redeemer: VaultRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(VaultDatum { collected, skimmed }) = datum
    expect Some(own_input) = find_input(tx.inputs, own_ref)
    expect Script(own_hash) = own_input.output.address.payment_credential

    // Đúng một UTxO kho vào, đúng một UTxO kho ra. Kho phí là một ô sổ duy nhất; cho
    // phép nhiều ô là mở đường cho phép cộng chồng chéo mà không hợp đồng nào theo kịp.
    let own_inputs =
      list.filter(
        tx.inputs,
        fn(input) { input.output.address.payment_credential == Script(own_hash) },
      )
    let own_outputs =
      list.filter(
        tx.outputs,
        fn(output) { output.address.payment_credential == Script(own_hash) },
      )

    expect [continuing] = own_outputs
    expect InlineDatum(raw_next) = continuing.datum
    expect VaultDatum { collected: next_collected, skimmed: next_skimmed }: VaultDatum =
      raw_next

    let carp_before = quantity_of(own_input.output.value, carp_policy, carp_name)
    let carp_after = quantity_of(continuing.value, carp_policy, carp_name)

    // Nghĩa vụ CÒN NỢ sau khi giao dịch này xong, tính trên tổng dòng vào mới.
    let owed = floor_div(next_collected * skim_bps, bps_scale) - next_skimmed

    let shape_ok = and {
        list.length(own_inputs) == 1,
        skim_bps > 0,
        skim_bps <= bps_scale,
        // Kho không được rút cạn ADA giữ chỗ — hết ADA là UTxO không tồn tại được.
        lovelace_of(continuing.value) >= lovelace_of(own_input.output.value),
        // Nghĩa vụ không bao giờ âm: `skimmed` không vượt phần tính trên `collected`.
        owed >= 0,
      }

    let action_ok =
      when redeemer is {
        // Nộp phí. Không cần chữ ký ai: con số khai phải khớp đúng giá trị thật chảy
        // vào, nên khai gian là giao dịch hỏng chứ không phải là lợi.
        Collect { amount } -> and {
            amount > 0,
            carp_after - carp_before == amount,
            next_collected == collected + amount,
            next_skimmed == skimmed,
          }

        // Trích phần nghĩa vụ sang kho tạm.
        Skim { amount } -> and {
            amount > 0,
            carp_before - carp_after == amount,
            next_collected == collected,
            next_skimmed == skimmed + amount,
            // Không được trích quá phần nghĩa vụ. Trích thừa là lấy tiền vận hành
            // đem nộp, và nó biến một bất biến thành một quyết định tuỳ hứng.
            next_skimmed <= floor_div(collected * skim_bps, bps_scale),
            escrow_receives(tx, escrow_hash, carp_policy, carp_name, amount),
          }

        // Tiêu phần vận hành. Đây là chỗ DUY NHẤT CARP rời kho mà không sang kho tạm.
        Operate -> and {
            list.has(tx.extra_signatories, operator_key),
            next_collected == collected,
            next_skimmed == skimmed,
            // Phần còn lại phải phủ được nghĩa vụ còn nợ.
            carp_after >= owed,
          }
      }

    shape_ok && action_ok
  }

  else(_) {
    fail
  }
}

fn find_input(inputs: List<Input>, own_ref: OutputReference) -> Option<Input> {
  list.find(inputs, fn(input) { input.output_reference == own_ref })
}

/// Đúng một UTxO đi về kho tạm, mang đúng `amount` CARP, và khai đúng con số đó.
fn escrow_receives(
  tx: Transaction,
  escrow_hash: ByteArray,
  policy: PolicyId,
  name: AssetName,
  amount: Int,
) -> Bool {
  let to_escrow =
    list.filter(
      tx.outputs,
      fn(output) { output.address.payment_credential == Script(escrow_hash) },
    )
  when to_escrow is {
    [only] -> {
      expect InlineDatum(raw) = only.datum
      expect EscrowDatum { carp }: EscrowDatum = raw
      and {
        quantity_of(only.value, policy, name) == amount,
        carp == amount,
      }
    }
    _ -> False
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bài kiểm. Mỗi bài đặt tên theo LUẬT nó khoá, không theo hàm nó gọi — đọc tên
// bài kiểm là biết hợp đồng hứa gì, không phải mở mã ra mới biết.
// ─────────────────────────────────────────────────────────────────────────────


fn run(
  datum: VaultDatum,
  redeemer: VaultRedeemer,
  tx_body: Transaction,
) -> Bool {
  fee_vault.spend(
    carp_policy,
    carp_name,
    skim_bps,
    escrow_hash,
    operator_key,
    Some(datum),
    redeemer,
    ref_at(0),
    tx_body,
  )
}

fn vault_utxo(lovelace: Int, carp: Int, d: VaultDatum) -> Output {
  script_output(vault_hash, value_with_carp(lovelace, carp), inline(d))
}

/// Nộp phí: `collected` tăng đúng bằng lượng CARP thật sự chảy vào.
test collect_records_the_exact_inflow() {
  let before = VaultDatum { collected: 0, skimmed: 0 }
  let after = VaultDatum { collected: 500, skimmed: 0 }
  run(
    before,
    Collect { amount: 500 },
    tx(
      [input_from(ref_at(0), vault_utxo(2_000_000, 0, before))],
      [vault_utxo(2_000_000, 500, after)],
      [],
      None,
    ),
  )
}

/// Khai nhiều hơn số thật vào: giao dịch hỏng. Đây là chỗ khiến `Collect` không cần
/// chữ ký của ai — khai gian không mang lại gì.
test collect_rejects_an_overstated_amount() {
  let before = VaultDatum { collected: 0, skimmed: 0 }
  let after = VaultDatum { collected: 900, skimmed: 0 }
  !run(
    before,
    Collect { amount: 900 },
    tx(
      [input_from(ref_at(0), vault_utxo(2_000_000, 0, before))],
      [vault_utxo(2_000_000, 500, after)],
      [],
      None,
    ),
  )
}

/// Khai ít hơn số thật vào cũng hỏng. Nếu cho qua thì kẻ nộp có thể "tặng" CARP mà
/// không làm tăng nghĩa vụ — nghe như thiệt cho họ, nhưng nó phá sổ.
test collect_rejects_an_understated_amount() {
  let before = VaultDatum { collected: 0, skimmed: 0 }
  let after = VaultDatum { collected: 100, skimmed: 0 }
  !run(
    before,
    Collect { amount: 100 },
    tx(
      [input_from(ref_at(0), vault_utxo(2_000_000, 0, before))],
      [vault_utxo(2_000_000, 500, after)],
      [],
      None,
    ),
  )
}

/// Trích đúng nghĩa vụ: thu 1000, nghĩa vụ 10% là 100.
test skim_moves_exactly_the_obligation() {
  let before = VaultDatum { collected: 1_000, skimmed: 0 }
  let after = VaultDatum { collected: 1_000, skimmed: 100 }
  run(
    before,
    Skim { amount: 100 },
    tx(
      [input_from(ref_at(0), vault_utxo(2_000_000, 1_000, before))],
      [
        vault_utxo(2_000_000, 900, after),
        script_output(
          escrow_hash,
          value_with_carp(2_000_000, 100),
          inline(EscrowDatum { carp: 100 }),
        ),
      ],
      [],
      None,
    ),
  )
}

/// Trích quá nghĩa vụ bị chặn. Trích thừa là lấy tiền vận hành đem nộp — nghe có vẻ
/// hào phóng, nhưng nó biến một bất biến thành một quyết định tuỳ hứng.
test skim_beyond_the_obligation_is_rejected() {
  let before = VaultDatum { collected: 1_000, skimmed: 0 }
  let after = VaultDatum { collected: 1_000, skimmed: 101 }
  !run(
    before,
    Skim { amount: 101 },
    tx(
      [input_from(ref_at(0), vault_utxo(2_000_000, 1_000, before))],
      [
        vault_utxo(2_000_000, 899, after),
        script_output(
          escrow_hash,
          value_with_carp(2_000_000, 101),
          inline(EscrowDatum { carp: 101 }),
        ),
      ],
      [],
      None,
    ),
  )
}

/// Phần trích phải đi về ĐÚNG kho tạm. Gửi vào ví riêng thì hỏng.
test skim_must_land_at_the_escrow_script() {
  let before = VaultDatum { collected: 1_000, skimmed: 0 }
  let after = VaultDatum { collected: 1_000, skimmed: 100 }
  !run(
    before,
    Skim { amount: 100 },
    tx(
      [input_from(ref_at(0), vault_utxo(2_000_000, 1_000, before))],
      [
        vault_utxo(2_000_000, 900, after),
        wallet_output(
          from_verification_key(operator_key),
          value_with_carp(2_000_000, 100),
        ),
      ],
      [],
      None,
    ),
  )
}

/// Kho tạm phải khai đúng số nó nhận. Khai lệch thì lần sau nó rời kho tạm với một
/// nghĩa vụ nhỏ hơn thực tế.
test skim_escrow_datum_must_match_the_value() {
  let before = VaultDatum { collected: 1_000, skimmed: 0 }
  let after = VaultDatum { collected: 1_000, skimmed: 100 }
  !run(
    before,
    Skim { amount: 100 },
    tx(
      [input_from(ref_at(0), vault_utxo(2_000_000, 1_000, before))],
      [
        vault_utxo(2_000_000, 900, after),
        script_output(
          escrow_hash,
          value_with_carp(2_000_000, 100),
          inline(EscrowDatum { carp: 1 }),
        ),
      ],
      [],
      None,
    ),
  )
}

/// Tiêu vận hành phần TRÊN mức nghĩa vụ: được. Thu 1000, nợ 100, giữ lại 100 thì
/// tiêu được 900.
test operate_may_spend_above_the_reserve() {
  let state = VaultDatum { collected: 1_000, skimmed: 0 }
  run(
    state,
    Operate,
    tx(
      [input_from(ref_at(0), vault_utxo(2_000_000, 1_000, state))],
      [
        vault_utxo(2_000_000, 100, state),
        wallet_output(
          from_verification_key(operator_key),
          value_with_carp(2_000_000, 900),
        ),
      ],
      [operator_key],
      None,
    ),
  )
}

/// Đây là bài kiểm chịu lực của cả hợp đồng: chạm vào phần nghĩa vụ thì hỏng, kể cả
/// khi chỉ thiếu MỘT đơn vị.
test operate_cannot_touch_the_reserve() {
  let state = VaultDatum { collected: 1_000, skimmed: 0 }
  !run(
    state,
    Operate,
    tx(
      [input_from(ref_at(0), vault_utxo(2_000_000, 1_000, state))],
      [
        vault_utxo(2_000_000, 99, state),
        wallet_output(
          from_verification_key(operator_key),
          value_with_carp(2_000_000, 901),
        ),
      ],
      [operator_key],
      None,
    ),
  )
}

/// Người lạ không tiêu được kho, kể cả khi giữ đủ phần nghĩa vụ.
test operate_needs_the_operator_signature() {
  let state = VaultDatum { collected: 1_000, skimmed: 0 }
  !run(
    state,
    Operate,
    tx(
      [input_from(ref_at(0), vault_utxo(2_000_000, 1_000, state))],
      [
        vault_utxo(2_000_000, 100, state),
        wallet_output(
          from_verification_key(stranger_key),
          value_with_carp(2_000_000, 900),
        ),
      ],
      [stranger_key],
      None,
    ),
  )
}

/// Tiêu vận hành không được sửa sổ. Hạ `collected` xuống là hạ nghĩa vụ xuống theo —
/// đường tấn công gọn nhất vào cả cơ chế, nên nó có bài kiểm riêng.
test operate_cannot_rewrite_the_ledger() {
  let state = VaultDatum { collected: 1_000, skimmed: 0 }
  let forged = VaultDatum { collected: 0, skimmed: 0 }
  !run(
    state,
    Operate,
    tx(
      [input_from(ref_at(0), vault_utxo(2_000_000, 1_000, state))],
      [
        vault_utxo(2_000_000, 0, forged),
        wallet_output(
          from_verification_key(operator_key),
          value_with_carp(2_000_000, 1_000),
        ),
      ],
      [operator_key],
      None,
    ),
  )
}

/// Hai UTxO kho trong một giao dịch bị chặn: một phép cộng trên hai ô sổ là chỗ để
/// một ô thoả điều kiện thay cho cả hai.
test vault_rejects_two_vault_inputs() {
  let state = VaultDatum { collected: 1_000, skimmed: 0 }
  !run(
    state,
    Operate,
    tx(
      [
        input_from(ref_at(0), vault_utxo(2_000_000, 1_000, state)),
        input_from(ref_at(1), vault_utxo(2_000_000, 1_000, state)),
      ],
      [
        vault_utxo(2_000_000, 100, state),
        wallet_output(
          from_verification_key(operator_key),
          value_with_carp(2_000_000, 1_900),
        ),
      ],
      [operator_key],
      None,
    ),
  )
}

/// Rút cạn ADA giữ chỗ bị chặn — UTxO không có ADA thì không tồn tại được, và một
/// kho không tồn tại được là một kho biến mất cùng nghĩa vụ của nó.
test vault_cannot_drain_its_min_ada() {
  let state = VaultDatum { collected: 1_000, skimmed: 0 }
  !run(
    state,
    Operate,
    tx(
      [input_from(ref_at(0), vault_utxo(5_000_000, 1_000, state))],
      [
        vault_utxo(1_000_000, 100, state),
        wallet_output(
          from_verification_key(operator_key),
          value_with_carp(4_000_000, 900),
        ),
      ],
      [operator_key],
      None,
    ),
  )
}
