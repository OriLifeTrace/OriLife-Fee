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
////
//// PHẢI NÓI THẲNG MỘT ĐIỀU, vì tiêu đề dễ đọc quá tay: cái được ép bằng mã là quan hệ
//// giữa `skimmed` và `collected`. `collected` thì KHÔNG có gì ép — nó tăng khi có người
//// gọi `Collect`, và hợp đồng không biết doanh thu thật của OriLife là bao nhiêu. Và
//// giá trị thật vào kho bạc là `10% × sàn/giá thị trường`, không phải 10% của doanh thu.
////
//// ─────────────────────────────────────────────────────────────────────────────
//// BỐN CHỖ ĐÃ VÁ Ở BẢN NÀY
////
//// 1. `escrow_receives` chỉ đòi "một output ở địa chỉ kho tạm, mang đúng `amount`".
////    `list.length(own_inputs) == 1` bên dưới chỉ đếm input CÙNG băm script, nên hai
////    instance kho phí khác tham số (khác băm) mỗi cái tự thấy mình là input duy nhất,
////    và MỘT output ở kho tạm thoả điều kiện cho CẢ HAI. Hai lần `skimmed` tăng, một
////    lần CARP rời kho. Nay khoản trích phải khai đúng băm kho phí đã trích ra nó.
////
////    Chỗ này không phải giả định xa: kho tạm KHÔNG nhận `skim_bps` hay `operator_key`
////    làm tham số, và thứ tự dựng là escrow TRƯỚC rồi vault mới nuốt `escrowHash`. Nên
////    hễ đổi tỉ lệ trích hoặc xoay khoá vận hành là băm vault đổi mà băm kho tạm KHÔNG
////    đổi — tiền đề của lỗ này tự sinh ra từ chính việc vá lỗ `Close` bên dưới.
////
//// 2. Khoản trích phải khai `parent = None`. Xem đầu `donation_escrow.ak`: kho tạm phân
////    biệt phần DƯ với khoản MỚI bằng trường đó, nên kho phí phải đóng dấu đúng.
////
//// 3. `Operate` thiếu `carp_after <= carp_before`, tức nó là một cửa NẠP không ghi sổ:
////    bơm CARP vào kho qua `Operate` thì `collected` đứng yên, và phần CARP đó không
////    bao giờ sinh nghĩa vụ.
////
//// 4. Không có đường đóng kho, mà mọi nhánh đều ép `lovelace_of(ra) >= lovelace_of(vào)`
////    ⟹ ADA giữ chỗ vào một chiều, nằm lại vĩnh viễn. Thêm `Close`, và nó cũng là đường
////    xoay `operator_key`: khoá là tham số biên dịch nên xoay khoá = dựng instance mới,
////    mà instance cũ trước đây không đóng lại được.
//// ─────────────────────────────────────────────────────────────────────────────

use aiken/collection/list
use cardano/address.{Script, from_verification_key}
use cardano/assets.{AssetName, PolicyId, lovelace_of, quantity_of}
use cardano/transaction.{InlineDatum, Input, Output, OutputReference, Transaction}
use orilife/fixtures.{
  carp_name, carp_policy, escrow_datum, escrow_hash, inline, input_from,
  operator_key, ref_at, script_output, skim_bps, stranger_key, tx,
  value_with_carp, vault_hash, wallet_output,
}
use orilife/math.{ceil_div}
use orilife/types.{
  Close, Collect, EscrowDatum, Operate, Skim, VaultDatum, VaultRedeemer,
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
  /// Khoá vận hành OriLife. Cần cho `Operate` và `Close`; nộp phí thì ai cũng nộp được.
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

    // Đúng một UTxO kho vào. Kho phí là một ô sổ duy nhất; cho phép nhiều ô là mở đường
    // cho phép cộng chồng chéo mà không hợp đồng nào theo kịp.
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

    let base_ok = and {
        list.length(own_inputs) == 1,
        skim_bps > 0,
        skim_bps <= bps_scale,
      }

    when redeemer is {
      // Đóng kho. Không có ô kho đi ra, nên nhánh này KHÔNG đọc datum tiếp theo — đó
      // cũng là lý do nó phải tách khỏi ba nhánh kia thay vì thêm một cờ.
      Close -> and {
          base_ok,
          list.has(tx.extra_signatories, operator_key),
          list.length(own_outputs) == 0,
          // Chỉ đóng được khi đã trả hết nghĩa vụ. Không có câu này thì `Close` là một
          // cửa thoát cho toàn bộ cơ chế.
          ceil_div(collected * skim_bps, bps_scale) == skimmed,
        }

      _ -> {
        expect [continuing] = own_outputs
        expect InlineDatum(raw_next) = continuing.datum
        expect VaultDatum { collected: next_collected, skimmed: next_skimmed }: VaultDatum =
          raw_next

        let carp_before = quantity_of(own_input.output.value, carp_policy, carp_name)
        let carp_after = quantity_of(continuing.value, carp_policy, carp_name)

        // Nghĩa vụ CÒN NỢ sau khi giao dịch này xong, tính trên tổng dòng vào mới.
        // Làm tròn LÊN — cùng chiều với trần được trích ở nhánh `Skim`, nếu không thì
        // phần chênh không trích hết được và kho không bao giờ đóng lại được.
        let owed = ceil_div(next_collected * skim_bps, bps_scale) - next_skimmed

        let shape_ok = and {
            base_ok,
            // Kho không được rút cạn ADA giữ chỗ — hết ADA là UTxO không tồn tại được.
            // ADA chỉ có đường vào; đường ra duy nhất là `Close`.
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
                next_skimmed <= ceil_div(collected * skim_bps, bps_scale),
                escrow_receives(
                  tx,
                  escrow_hash,
                  own_hash,
                  carp_policy,
                  carp_name,
                  amount,
                ),
              }

            // Tiêu phần vận hành. Đây là chỗ DUY NHẤT CARP rời kho mà không sang kho tạm.
            Operate -> and {
                list.has(tx.extra_signatories, operator_key),
                next_collected == collected,
                next_skimmed == skimmed,
                // Chỉ được RÚT ra, không được nạp vào. Nạp qua đây là nạp không ghi sổ:
                // `collected` đứng yên nên phần CARP đó không bao giờ sinh nghĩa vụ.
                // Muốn nạp thì gọi `Collect`.
                carp_after <= carp_before,
                // Phần còn lại phải phủ được nghĩa vụ còn nợ.
                carp_after >= owed,
              }

            // Không tới được: `Close` đã bắt ở nhánh trên. Có mặt để phép khớp đủ nhánh.
            Close -> False
          }

        shape_ok && action_ok
      }
    }
  }

  else(_) {
    fail
  }
}

fn find_input(inputs: List<Input>, own_ref: OutputReference) -> Option<Input> {
  list.find(inputs, fn(input) { input.output_reference == own_ref })
}

/// Đúng một UTxO đi về kho tạm, mang đúng `amount` CARP, khai đúng con số đó, khai đúng
/// băm kho phí đã trích ra nó, và khai mình là khoản MỚI (`parent = None`).
///
/// Ba lời khai chứ không phải một, và mỗi cái chặn một thứ khác nhau:
///   * `carp == amount` — chặn khai lệch để lần sau rời kho tạm rẻ hơn thực tế;
///   * `vault == own_hash` — chặn hai instance kho phí dùng chung MỘT khoản trích;
///   * `parent == None` — chặn khoản trích tự nhận là "phần dư" của một ô kho tạm nào đó,
///     là chính cái làm phép đo `giữ − trả_lại` bên kho tạm sai.
fn escrow_receives(
  tx: Transaction,
  escrow_hash: ByteArray,
  own_hash: ByteArray,
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
      expect EscrowDatum { carp, vault, parent }: EscrowDatum = raw
      and {
        quantity_of(only.value, policy, name) == amount,
        carp == amount,
        vault == own_hash,
        parent == None,
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

/// Khoản trích đúng khuôn: khai đủ ba thứ kho phí đòi.
fn skim_output(carp: Int) -> Output {
  script_output(
    escrow_hash,
    value_with_carp(2_000_000, carp),
    inline(escrow_datum(carp, None)),
  )
}

fn to(key: ByteArray, carp: Int) -> Output {
  wallet_output(from_verification_key(key), value_with_carp(2_000_000, carp))
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
      [vault_utxo(2_000_000, 900, after), skim_output(100)],
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
      [vault_utxo(2_000_000, 899, after), skim_output(101)],
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
      [vault_utxo(2_000_000, 900, after), to(operator_key, 100)],
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
          inline(escrow_datum(1, None)),
        ),
      ],
      [],
      None,
    ),
  )
}

/// Khoản trích phải khai ĐÚNG băm kho phí đã trích ra nó.
///
/// Không có câu này thì hai instance kho phí khác tham số cùng `Skim` một lượng trong
/// MỘT giao dịch sẽ cùng thoả — mỗi cái chỉ đếm input cùng băm với mình nên đều thấy
/// mình là input duy nhất, và cùng chấp nhận một output ở kho tạm. Hai lần `skimmed`
/// tăng, một lần CARP rời kho.
test skim_output_must_name_this_vault() {
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
          inline(
            EscrowDatum { carp: 100, vault: stranger_key, parent: None },
          ),
        ),
      ],
      [],
      None,
    ),
  )
}

/// Khoản trích phải khai mình là khoản MỚI. Khai `parent = Some(...)` là tự nhận mình
/// là phần dư của một ô kho tạm — đúng cái làm phép đo `giữ − trả_lại` bên kho tạm sai.
test skim_output_must_be_a_fresh_deposit() {
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
          inline(escrow_datum(100, Some(ref_at(9)))),
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
      [vault_utxo(2_000_000, 100, state), to(operator_key, 900)],
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
      [vault_utxo(2_000_000, 99, state), to(operator_key, 901)],
      [operator_key],
      None,
    ),
  )
}

/// `Operate` KHÔNG phải cửa nạp. Bơm CARP vào kho qua đây thì `collected` đứng yên, nên
/// phần CARP đó không bao giờ sinh nghĩa vụ — nạp thì phải gọi `Collect`.
test operate_cannot_add_carp_without_recording_it() {
  let state = VaultDatum { collected: 1_000, skimmed: 0 }
  !run(
    state,
    Operate,
    tx(
      [input_from(ref_at(0), vault_utxo(2_000_000, 1_000, state))],
      [vault_utxo(2_000_000, 5_000, state)],
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
      [vault_utxo(2_000_000, 100, state), to(stranger_key, 900)],
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
      [vault_utxo(2_000_000, 100, forged), to(operator_key, 900)],
      [operator_key],
      None,
    ),
  )
}

/// Đóng kho khi đã trả hết nghĩa vụ: được, và ADA giữ chỗ đi ra theo.
///
/// Không có nhánh này thì mọi nhánh khác đều ép `lovelace ra >= lovelace vào`, tức ADA
/// vào một chiều và nằm lại vĩnh viễn. Nó cũng là đường DUY NHẤT xoay `operator_key`:
/// khoá là tham số biên dịch, xoay khoá là dựng instance mới, mà instance cũ trước đây
/// không đóng lại được.
test close_frees_the_reserved_ada_once_the_obligation_is_settled() {
  let settled = VaultDatum { collected: 1_000, skimmed: 100 }
  run(
    settled,
    Close,
    tx(
      [input_from(ref_at(0), vault_utxo(5_000_000, 900, settled))],
      [to(operator_key, 900)],
      [operator_key],
      None,
    ),
  )
}

/// Còn nợ một đơn vị thì không đóng được. Không có câu này thì `Close` là cửa thoát
/// cho toàn bộ cơ chế.
test close_requires_the_obligation_to_be_settled() {
  let owing = VaultDatum { collected: 1_000, skimmed: 99 }
  !run(
    owing,
    Close,
    tx(
      [input_from(ref_at(0), vault_utxo(5_000_000, 901, owing))],
      [to(operator_key, 901)],
      [operator_key],
      None,
    ),
  )
}

/// Người lạ không đóng được kho, kể cả khi nghĩa vụ đã trả hết.
test close_needs_the_operator_signature() {
  let settled = VaultDatum { collected: 1_000, skimmed: 100 }
  !run(
    settled,
    Close,
    tx(
      [input_from(ref_at(0), vault_utxo(5_000_000, 900, settled))],
      [to(stranger_key, 900)],
      [stranger_key],
      None,
    ),
  )
}

/// "Đóng" mà vẫn để lại một ô kho thì không phải đóng. Cho qua là mở đường dựng một ô
/// kho mới với sổ bịa ra.
test close_rejects_a_continuing_vault_output() {
  let settled = VaultDatum { collected: 1_000, skimmed: 100 }
  let forged = VaultDatum { collected: 0, skimmed: 0 }
  !run(
    settled,
    Close,
    tx(
      [input_from(ref_at(0), vault_utxo(5_000_000, 900, settled))],
      [vault_utxo(2_000_000, 900, forged), to(operator_key, 0)],
      [operator_key],
      None,
    ),
  )
}

/// Nghĩa vụ làm tròn LÊN, và trần được trích làm tròn LÊN cùng chiều — nếu hai chỗ đó
/// lệch nhau thì phần chênh không trích hết được và kho vĩnh viễn không đóng được.
///
/// Thu 1005 với 10%: nghĩa vụ đúng là 100,5 ⟹ phải trích 101, không phải 100.
test the_obligation_rounds_up_and_stays_reachable() {
  let before = VaultDatum { collected: 1_005, skimmed: 0 }
  let after = VaultDatum { collected: 1_005, skimmed: 101 }
  run(
    before,
    Skim { amount: 101 },
    tx(
      [input_from(ref_at(0), vault_utxo(2_000_000, 1_005, before))],
      [vault_utxo(2_000_000, 904, after), skim_output(101)],
      [],
      None,
    ),
  )
}

/// Và sau khi trích đủ 101 thì kho đóng được — đó là vế thứ hai của bài trên, tách ra
/// vì nó kiểm một hợp đồng khác: `Close` đòi `ceil(collected × bps) == skimmed`.
test rounding_up_still_lets_the_vault_close() {
  let settled = VaultDatum { collected: 1_005, skimmed: 101 }
  run(
    settled,
    Close,
    tx(
      [input_from(ref_at(0), vault_utxo(5_000_000, 904, settled))],
      [to(operator_key, 904)],
      [operator_key],
      None,
    ),
  )
}
