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
////
//// 5. Mọi phép so về NƠI ĐẾN chỉ chạm `payment_credential`, tức phần uỷ quyền của địa
////    chỉ là một trường TỰ DO. `Address` có hai phần: cùng băm script mà khác phần uỷ
////    quyền là HAI địa chỉ trên chuỗi, cả hai đều chạy đúng validator này. Ghép với
////    `Collect` — nhánh cố ý KHÔNG đòi chữ ký ai — thì bất kỳ ai cầm một chút CARP và
////    phí giao dịch cũng đẩy được ô kho sang một địa chỉ khác: tài sản không mất (vẫn
////    trong script), nhưng `utxosAt(<địa chỉ kho>)` mất dấu nó, mà đó đúng là cách cả
////    bốn kịch bản vận hành trong `onchain/scripts/` tìm ô kho. Kẻ dựng giao dịch còn
////    hưởng phần thưởng uỷ quyền trên toàn bộ ADA giữ chỗ, lặp lại mỗi epoch.
////
////    Nay ô kho đi ra phải ở ĐÚNG địa chỉ của ô kho đi vào (`own_input.output.address`),
////    và khoản trích phải ở đúng địa chỉ kho tạm trọn vẹn. Neo vào địa chỉ của chính ô
////    đang tiêu chứ không vào một hằng — băm của chính mình là một vòng vô tận, và một
////    hằng sẽ nói sai ngay khi kho được deploy ở dạng địa chỉ khác.
////
////    Cùng họ: `reference_script` của ô kho đi ra cũng là một trường không phép so nào
////    chạm tới, nên ai cũng đính được một script lớn vào ô kho qua `Collect`. Không mất
////    tiền (kẻ đính tự trả min-ADA), nhưng mọi lượt tiêu sau phải chở thêm khối byte đó.
////    Nay ô kho đi ra phải có `reference_script == None`.
//// ─────────────────────────────────────────────────────────────────────────────
////
//// ─────────────────────────────────────────────────────────────────────────────
//// NFT SỔ, UTxO LẠC, PHIÊN ĐẤU GIÁ — bản dựng lại instance
////
//// 6. Ô sổ được nhận ra bằng NFT `vault_nft_name` (policy = băm chính script này, đúc
////    đúng một lần vì `seed` bị tiêu khi mở kho), không bằng địa chỉ. Trước đây một UTxO
////    ở địa chỉ kho mang datum tự đặt trông giống hệt sổ.
////
//// 7. `datum` đổi sang `Option<Data>`. Trước đây `expect Some(VaultDatum{..}) = datum`
////    khoá chết mọi UTxO gửi nhầm (không datum, datum lạ): không nhánh nào tiêu lại được,
////    tức tài sản nằm TRONG sân kho mà NGOÀI sổ. Nay đầu vào lạc tiêu được, nhưng chỉ đi
////    cùng ô sổ, và CARP của nó chỉ có một lối ra: vào sổ qua `Collect`. Lovelace và token
////    khác của nó KHÔNG bị ràng — thưởng cho người gom. Hệ quả: mọi UTxO phụ đặt tại địa
////    chỉ kho (kể cả một ô giữ reference script) là của chùa — đừng đặt gì ở đó.
////
//// 8. Khoản trích mở một phiên đấu giá giảm dần ở kho tạm. `listed_at` của khoản trích
////    phải bằng cận trên khoảng hiệu lực của giao dịch `Skim`, và khoảng đó không rộng
////    quá `listing_window_ms` ⟹ mốc mở phiên nằm trong `[bây giờ, bây giờ + cửa sổ]`:
////    không lùi ngày để mua rẻ ngay, không đẩy xa để đóng băng giá ở trần.
//// ─────────────────────────────────────────────────────────────────────────────

use aiken/collection/dict
use aiken/collection/list
use aiken/interval.{Finite}
use cardano/address.{Script, from_script, from_verification_key}
use cardano/assets.{
  AssetName, PolicyId, Value, add, from_asset, from_lovelace, lovelace_of,
  quantity_of, tokens,
}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use orilife/fixtures.{
  carp_name, carp_policy, escrow_datum, escrow_hash, inbox_hash, inline,
  input_from, now_ms, operator_key, ref_at, rehomed_script_output, script_output,
  seed_ref, skim_bps, stranger_key, tx, tx_window_ms, value_with_carp,
  vault_hash, wallet_output, with_vault_nft,
}
use orilife/math.{ceil_div}
use orilife/types.{
  Burn, Close, Collect, EscrowDatum, Open, Operate, Skim, VaultDatum, VaultMint,
  VaultRedeemer, vault_nft_name,
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
  /// Độ rộng tối đa (ms) khoảng hiệu lực của giao dịch `Skim`. Cận trên khoảng đó thành
  /// mốc mở phiên đấu giá ở kho tạm, nên cửa sổ này là trần của việc đẩy mốc ra xa
  /// (đóng băng giá ở trần). Cận dưới thì sổ cái tự chặn: không vượt được thời điểm thật.
  listing_window_ms: Int,
  /// UTxO ví bị tiêu lúc mở kho. Tiêu rồi thì không tồn tại nữa, nên NFT sổ chỉ đúc được
  /// một lần cho mỗi instance. Đặt CUỐI để kịch bản chọn seed rồi mới biết băm kho.
  seed: OutputReference,
) {
  mint(redeemer: VaultMint, policy_id: PolicyId, tx: Transaction) {
    let minted = dict.to_pairs(tokens(tx.mint, policy_id))
    when redeemer is {
      // Mở kho. Ô sổ sinh ra phải là ô sổ TRẮNG ở đúng địa chỉ enterprise mà kịch bản
      // dựng (`validatorToAddress`, không phần uỷ quyền): sổ bắt đầu từ 0/0 thì mọi con
      // số về sau đều truy được về một dòng vào thật.
      // Lọc RỘNG theo băm script rồi đòi đúng một, như `own_outputs` ở nhánh spend: một ô
      // thứ hai ở địa chỉ dời nhà là một chỗ không phép so địa chỉ nào soi tới.
      Open ->
        when
          list.filter(
            tx.outputs,
            fn(output) {
              output.address.payment_credential == Script(policy_id)
            },
          )
        is {
          [opened] -> {
            let empty_ledger: Data = VaultDatum { collected: 0, skimmed: 0 }
            and {
              // Tham số hỏng thì kho mở ra là kho chết: mọi nhánh spend đòi `skim_bps`
              // hợp lệ (kể cả `Close`), `Skim` đòi cửa sổ dương — ADA giữ chỗ sẽ nằm lại
              // vĩnh viễn. Chặn ở lần mở, trước khi có đồng nào vào.
              skim_bps > 0,
              skim_bps <= bps_scale,
              listing_window_ms > 0,
              // One-shot. Không có câu này thì ai cũng đúc thêm NFT, dựng một sổ thứ hai.
              list.any(tx.inputs, fn(input) { input.output_reference == seed }),
              minted == [Pair(vault_nft_name, 1)],
              opened.address == from_script(policy_id),
              holds_vault_nft(opened, policy_id),
              opened.datum == InlineDatum(empty_ledger),
              opened.reference_script == None,
              // Mở kho kèm CARP là nạp không ghi sổ: số CARP đó không bao giờ sinh nghĩa vụ.
              quantity_of(opened.value, carp_policy, carp_name) == 0,
            }
          }
          _ -> False
        }
      // Đốt. Không cần soi gì thêm: NFT chỉ rời được ô sổ qua `Close`, và `Close` ép đốt.
      Burn -> minted == [Pair(vault_nft_name, -1)]
    }
  }

  spend(
    datum: Option<Data>,
    redeemer: VaultRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(own_input) = find_input(tx.inputs, own_ref)
    expect Script(own_hash) = own_input.output.address.payment_credential

    let own_inputs =
      list.filter(
        tx.inputs,
        fn(input) {
          input.output.address.payment_credential == Script(own_hash)
        },
      )
    // Phép LỌC ở đây cố ý RỘNG — chỉ theo `payment_credential`, không theo địa chỉ đầy
    // đủ. Hai chiều có đáp án ngược nhau và đừng gộp chúng: lọc rộng là thứ bắt được
    // MỌI đầu ra chạy script này, kể cả đầu ra dời nhà, nên `Close` (đòi 0 đầu ra) và
    // `expect [continuing]` (đòi đúng 1) không bị lách bằng cách đổi phần uỷ quyền.
    // Việc ghim NƠI ĐẾN thì làm riêng, bằng một phép so địa chỉ ĐẦY ĐỦ ở `shape_ok`.
    let own_outputs =
      list.filter(
        tx.outputs,
        fn(output) { output.address.payment_credential == Script(own_hash) },
      )

    // Ô sổ là ô giữ NFT. Mọi đầu vào khác ở script này là đầu vào LẠC: ai đó gửi nhầm,
    // datum gì cũng được, kể cả không có. Datum của chúng không bao giờ được đọc.
    let ledger_inputs =
      list.filter(
        own_inputs,
        fn(input) { holds_vault_nft(input.output, own_hash) },
      )
    let stray_carp =
      list.foldl(
        own_inputs,
        0,
        fn(input, acc) {
          if holds_vault_nft(input.output, own_hash) {
            acc
          } else {
            acc + quantity_of(input.output.value, carp_policy, carp_name)
          }
        },
      )

    if holds_vault_nft(own_input.output, own_hash) {
      // Ô sổ luôn có datum đúng — `Open` và mọi nhánh tiếp-tục đều ép thế — nên ở đây
      // datum hỏng là sổ hỏng, không phải UTxO lạc.
      expect Some(raw_ledger) = datum
      expect VaultDatum { collected, skimmed }: VaultDatum = raw_ledger

      let base_ok = and {
          // Đúng MỘT ô sổ vào. Kho phí là một ô sổ duy nhất; cho phép nhiều ô là mở đường
          // cho phép cộng chồng chéo. Đầu vào lạc thì được đi kèm — chúng không phải sổ.
          list.length(ledger_inputs) == 1,
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
            // NFT chết cùng sổ. Để nó sống là để lại một "bằng chứng sổ thật" trôi nổi,
            // gắn được vào một ô mang datum bịa ra.
            dict.to_pairs(tokens(tx.mint, own_hash)) == [
              Pair(vault_nft_name, -1),
            ],
            // Chỉ đóng được khi đã trả hết nghĩa vụ. Không có câu này thì `Close` là một
            // cửa thoát cho toàn bộ cơ chế.
            ceil_div(collected * skim_bps, bps_scale) == skimmed,
          }

        _ -> {
          expect [continuing] = own_outputs
          expect InlineDatum(raw_next) = continuing.datum
          expect VaultDatum { collected: next_collected, skimmed: next_skimmed }: VaultDatum =
            raw_next

          let carp_before =
            quantity_of(own_input.output.value, carp_policy, carp_name)
          let carp_after = quantity_of(continuing.value, carp_policy, carp_name)

          // Nghĩa vụ CÒN NỢ sau khi giao dịch này xong, tính trên tổng dòng vào mới.
          // Làm tròn LÊN — cùng chiều với trần được trích ở nhánh `Skim`, nếu không thì
          // phần chênh không trích hết được và kho không bao giờ đóng lại được.
          let owed =
            ceil_div(next_collected * skim_bps, bps_scale) - next_skimmed

          let shape_ok = and {
              base_ok,
              // Ô kho phải ở lại ĐÚNG địa chỉ cũ — cả phần thanh toán lẫn phần uỷ quyền.
              // So `payment_credential` thôi là để trống phần uỷ quyền cho kẻ dựng giao
              // dịch điền, và `Collect` không đòi chữ ký ai nên "kẻ dựng giao dịch" là
              // bất kỳ ai. Neo vào ô đang tiêu, không vào hằng.
              continuing.address == own_input.output.address,
              // Ô kho đi ra phải mang NFT theo. Không có câu này thì NFT ra ví, và ô ở lại
              // là một ô không ai còn nhận ra là sổ — còn NFT thì gắn được vào sổ bịa.
              holds_vault_nft(continuing, own_hash),
              // Ô kho không mang reference script. `Collect` không đòi chữ ký ai, nên để
              // trống trường này là cho bất kỳ ai đính một script lớn vào ô kho: không mất
              // tiền (kẻ đính tự trả min-ADA, `Close` rút lại được), nhưng mọi lượt tiêu
              // sau phải chở thêm khối byte đó. Không kịch bản nào trong `onchain/scripts/`
              // dùng ô kho làm chỗ để script — cả ba đều `attach.SpendingValidator` trực tiếp.
              continuing.reference_script == None,
              // Kho không được rút cạn ADA giữ chỗ — hết ADA là UTxO không tồn tại được.
              // ADA chỉ có đường vào; đường ra duy nhất là `Close`.
              lovelace_of(continuing.value) >= lovelace_of(
                own_input.output.value,
              ),
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
                  // CARP của MỌI đầu vào khoá bằng script (trừ chính ô sổ) phải vào sổ:
                  // ô lạc của kho, ô của MỌI phiên bản hộp thư, và script bất kỳ khác.
                  // Hộp thư bake băm kho nhưng kho không biết băm hộp thư; chỉ đếm ô lạc
                  // của kho thì hai phiên bản hộp thư cùng gom, mỗi `withdraw` chỉ thấy
                  // CARP của chính nó, và sổ chỉ cần tăng bằng phần của MỘT bên.
                  // Tổng dưới đây gồm cả ô sổ (nó cũng là đầu vào script) nên trừ
                  // `carp_before` để ra "mọi đầu vào script trừ ô sổ" — rẻ hơn so
                  // `output_reference` của từng đầu vào.
                  carp_after - carp_before >= script_inputs_carp(
                    tx.inputs,
                    carp_policy,
                    carp_name,
                  ) - carp_before,
                  next_collected == collected + amount,
                  next_skimmed == skimmed,
                }

              // Trích phần nghĩa vụ sang kho tạm.
              Skim { amount } -> and {
                  amount > 0,
                  // CARP lạc chỉ có một lối ra là vào sổ. Cho nó đi kèm `Skim` là cho nó
                  // ra ví mà không dòng nào ghi lại.
                  stray_carp == 0,
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
                    listing_window_ms,
                  ),
                }

              // Tiêu phần vận hành. Đây là chỗ DUY NHẤT CARP rời kho mà không sang kho tạm.
              Operate -> and {
                  list.has(tx.extra_signatories, operator_key),
                  // Khoá vận hành không có quyền gì trên CARP lạc: chưa vào sổ thì chưa
                  // sinh nghĩa vụ, nên cho nó ra theo `Operate` là rút trước khi ghi.
                  stray_carp == 0,
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
    } else {
      // Đầu vào LẠC. Hợp lệ khi và chỉ khi ô sổ thật cùng bị tiêu, ô sổ đi ra, và phần
      // CARP sổ tăng phủ được CARP của MỌI đầu vào lạc ở script này. Không đòi chữ ký ai
      // và không mở quyền mới cho khoá vận hành: nhánh của chính ô sổ vẫn chạy đủ luật.
      let ledger_outputs =
        list.filter(
          own_outputs,
          fn(output) { holds_vault_nft(output, own_hash) },
        )
      when (ledger_inputs, ledger_outputs) is {
        ([ledger_input], [ledger_output]) ->
          quantity_of(ledger_output.value, carp_policy, carp_name) - quantity_of(
            ledger_input.output.value,
            carp_policy,
            carp_name,
          ) >= stray_carp
        _ -> False
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

/// Tổng CARP của mọi đầu vào có phần thanh toán là script (kể cả ô đang tiêu).
fn script_inputs_carp(
  inputs: List<Input>,
  policy: PolicyId,
  name: AssetName,
) -> Int {
  list.foldl(
    inputs,
    0,
    fn(input, acc) {
      when input.output.address.payment_credential is {
        Script(_) -> acc + quantity_of(input.output.value, policy, name)
        _ -> acc
      }
    },
  )
}

/// Đếm đúng 1, không phải "có": tổng cung là 1, nên lớn hơn 1 là chuyện không xảy ra được
/// — và nếu xảy ra thì phải hỏng chứ không được coi là sổ.
fn holds_vault_nft(output: Output, policy: PolicyId) -> Bool {
  quantity_of(output.value, policy, vault_nft_name) == 1
}

/// Đúng một UTxO đi về kho tạm, ĐẬU ĐÚNG ĐỊA CHỈ kho tạm, mang đúng `amount` CARP, khai
/// đúng con số đó, khai đúng băm kho phí đã trích ra nó, khai mình là khoản MỚI
/// (`parent = None`), và khai mốc mở phiên đấu giá đúng bằng cận trên khoảng hiệu lực.
///
/// Mỗi lời khai chặn một thứ khác nhau:
///   * `address == from_script(escrow_hash)` — chặn khoản trích đậu ở một địa chỉ khác
///     mang cùng băm script. Kho tạm được dựng bằng `validatorToAddress(NETWORK, script)`
///     (`onchain/scripts/common.mjs`), tức địa chỉ enterprise KHÔNG phần uỷ quyền, và
///     `05_swap_and_donate.mjs` tìm nó bằng `utxosAt(escrowAddress)`. Thiếu câu này thì
///     `Skim` đẩy được tiền tới một địa chỉ mà chính đường nộp kho bạc không tìm ra.
///   * `carp == amount` — chặn khai lệch để lần sau rời kho tạm rẻ hơn thực tế;
///   * `vault == own_hash` — chặn hai instance kho phí dùng chung MỘT khoản trích;
///   * `parent == None` — chặn khoản trích tự nhận là "phần dư" của một ô kho tạm nào đó,
///     là chính cái làm phép đo `giữ − trả_lại` bên kho tạm sai;
///   * `listed_at == upper`, `upper - lower <= listing_window_ms`, hai cận hữu hạn — mốc
///     mở phiên nằm trong `[bây giờ, bây giờ + cửa sổ]`. Lùi mốc là mua rẻ ngay khi vừa
///     trích; đẩy mốc xa là đóng băng giá ở trần để không ai mua.
fn escrow_receives(
  tx: Transaction,
  escrow_hash: ByteArray,
  own_hash: ByteArray,
  policy: PolicyId,
  name: AssetName,
  amount: Int,
  listing_window_ms: Int,
) -> Bool {
  let to_escrow =
    list.filter(
      tx.outputs,
      fn(output) { output.address.payment_credential == Script(escrow_hash) },
    )
  when to_escrow is {
    [only] -> {
      expect InlineDatum(raw) = only.datum
      expect EscrowDatum { carp, vault, parent, listed_at }: EscrowDatum = raw
      when
        (
          tx.validity_range.lower_bound.bound_type,
          tx.validity_range.upper_bound.bound_type,
        )
      is {
        (Finite(lower), Finite(upper)) -> and {
            only.address == from_script(escrow_hash),
            quantity_of(only.value, policy, name) == amount,
            carp == amount,
            vault == own_hash,
            parent == None,
            listing_window_ms > 0,
            upper - lower <= listing_window_ms,
            listed_at == upper,
          }
        // Một đầu để ngỏ thì không có "bây giờ" nào để neo mốc vào.
        _ -> False
      }
    }
    _ -> False
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bài kiểm. Mỗi bài đặt tên theo LUẬT nó khoá, không theo hàm nó gọi — đọc tên
// bài kiểm là biết hợp đồng hứa gì, không phải mở mã ra mới biết.
// ─────────────────────────────────────────────────────────────────────────────

/// Cửa sổ niêm yết trong bài kiểm — bằng giá trị thử Preprod (1 giờ). Khoảng hiệu lực
/// mặc định của `tx` rộng `tx_window_ms` (1 phút), nằm gọn trong cửa sổ này.
const listing_window: Int = 3_600_000

/// Mốc mở phiên đúng luật cho một `Skim` dùng khoảng hiệu lực mặc định: cận trên.
const listed_now: Int = now_ms + tx_window_ms

fn spend_with(
  window: Int,
  own_ref: OutputReference,
  datum: Option<Data>,
  redeemer: VaultRedeemer,
  tx_body: Transaction,
) -> Bool {
  fee_vault.spend(
    carp_policy,
    carp_name,
    skim_bps,
    escrow_hash,
    operator_key,
    window,
    seed_ref,
    datum,
    redeemer,
    own_ref,
    tx_body,
  )
}

/// Tiêu ô sổ ở `ref_at(0)`.
fn run(datum: VaultDatum, redeemer: VaultRedeemer, tx_body: Transaction) -> Bool {
  let raw: Data = datum
  spend_with(listing_window, ref_at(0), Some(raw), redeemer, tx_body)
}

/// Tiêu một đầu vào bất kỳ ở script kho, với datum tuỳ ý (kể cả không có).
fn run_at(
  own_ref: OutputReference,
  datum: Option<Data>,
  redeemer: VaultRedeemer,
  tx_body: Transaction,
) -> Bool {
  spend_with(listing_window, own_ref, datum, redeemer, tx_body)
}

/// Ô sổ thật: ở địa chỉ kho, giữ NFT.
fn vault_utxo(lovelace: Int, carp: Int, d: VaultDatum) -> Output {
  script_output(
    vault_hash,
    with_vault_nft(value_with_carp(lovelace, carp)),
    inline(d),
  )
}

/// Ô ở địa chỉ kho, datum đúng khuôn sổ, nhưng KHÔNG giữ NFT.
fn bare_vault_utxo(lovelace: Int, carp: Int, d: VaultDatum) -> Output {
  script_output(vault_hash, value_with_carp(lovelace, carp), inline(d))
}

/// UTxO gửi nhầm tới địa chỉ kho bằng ví thường: không datum.
fn stray_utxo(carp: Int) -> Output {
  script_output(vault_hash, value_with_carp(3_000_000, carp), NoDatum)
}

/// Khoản trích đúng khuôn: khai đủ mọi thứ kho phí đòi.
fn skim_output(carp: Int) -> Output {
  script_output(
    escrow_hash,
    value_with_carp(2_000_000, carp),
    inline(escrow_datum(carp, None, listed_now)),
  )
}

fn to(key: ByteArray, carp: Int) -> Output {
  wallet_output(from_verification_key(key), value_with_carp(2_000_000, carp))
}

/// Giao dịch đóng kho: như `tx`, cộng việc đốt NFT sổ.
fn close_tx(
  inputs: List<Input>,
  outputs: List<Output>,
  signatories: List<ByteArray>,
  donation: Option<Int>,
) -> Transaction {
  Transaction {
    ..tx(inputs, outputs, signatories, donation),
    mint: from_asset(vault_hash, vault_nft_name, -1),
  }
}

/// Ô kho ĐI RA ở cùng băm script nhưng gắn phần uỷ quyền của một khoá lạ — tức một địa
/// chỉ KHÁC trên chuỗi, vẫn chạy đúng validator này.
fn rehomed_vault_utxo(lovelace: Int, carp: Int, d: VaultDatum) -> Output {
  rehomed_script_output(
    vault_hash,
    stranger_key,
    with_vault_nft(value_with_carp(lovelace, carp)),
    inline(d),
  )
}

/// Khoản trích đi về đúng băm kho tạm nhưng ở một địa chỉ dời nhà.
fn rehomed_skim_output(carp: Int) -> Output {
  rehomed_script_output(
    escrow_hash,
    stranger_key,
    value_with_carp(2_000_000, carp),
    inline(escrow_datum(carp, None, listed_now)),
  )
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
          inline(escrow_datum(1, None, listed_now)),
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
            EscrowDatum {
              carp: 100,
              vault: stranger_key,
              parent: None,
              listed_at: listed_now,
            },
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
          inline(escrow_datum(100, Some(ref_at(9)), listed_now)),
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
    close_tx(
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
    close_tx(
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
    close_tx(
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
    close_tx(
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
    close_tx(
      [input_from(ref_at(0), vault_utxo(5_000_000, 904, settled))],
      [to(operator_key, 904)],
      [operator_key],
      None,
    ),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ĐỊA CHỈ ĐẦY ĐỦ, KHÔNG PHẢI BĂM SCRIPT
//
// Sáu bài dưới đây đi theo CẶP: mỗi bài âm khác bài dương của nó ĐÚNG MỘT THỨ —
// phần uỷ quyền của một địa chỉ. Không có cặp thì một bài âm đỏ không chứng minh
// được nó đỏ vì điều đang định ghim, nó có thể đỏ vì bất cứ chốt nào khác trên
// đường đi.
// ─────────────────────────────────────────────────────────────────────────────

/// CỰC DƯƠNG. Ô kho đi ra ở ĐÚNG địa chỉ ô kho đi vào: qua.
///
/// Giống hệt bài âm ngay dưới, khác đúng phần uỷ quyền của địa chỉ đầu ra.
test collect_passes_when_the_vault_stays_at_its_exact_address() {
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

/// CỰC ÂM — ĐÂY LÀ BÀI CỦA LỖ ĐÃ VÁ.
///
/// `Collect` không đòi chữ ký ai, cố ý. Nên nếu nơi đến chỉ bị soi theo băm script thì
/// bất kỳ ai cầm một chút CARP và phí giao dịch cũng đẩy được ô kho sang một địa chỉ
/// khác cùng băm: tài sản không rời script, nhưng `utxosAt(vaultAddress)` — cách cả bốn
/// kịch bản trong `onchain/scripts/` tìm ô kho — mất dấu nó, và phần thưởng uỷ quyền
/// trên toàn bộ ADA giữ chỗ chảy về khoá của kẻ dựng giao dịch, lặp mỗi epoch.
test collect_cannot_rehome_the_vault_to_another_stake_credential() {
  let before = VaultDatum { collected: 0, skimmed: 0 }
  let after = VaultDatum { collected: 500, skimmed: 0 }
  !run(
    before,
    Collect { amount: 500 },
    tx(
      [input_from(ref_at(0), vault_utxo(2_000_000, 0, before))],
      [rehomed_vault_utxo(2_000_000, 500, after)],
      [],
      None,
    ),
  )
}

/// CỰC ÂM. Cùng hình dạng với bài dương `collect_passes_when_the_vault_stays_at_its_exact_address`,
/// khác đúng một thứ: ô kho đi ra mang một reference script do kẻ dựng giao dịch đính vào.
test collect_cannot_attach_a_reference_script_to_the_vault() {
  let before = VaultDatum { collected: 0, skimmed: 0 }
  let after = VaultDatum { collected: 500, skimmed: 0 }
  let loaded =
    Output {
      ..vault_utxo(2_000_000, 500, after),
      reference_script: Some(
        #"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      ),
    }
  !run(
    before,
    Collect { amount: 500 },
    tx(
      [input_from(ref_at(0), vault_utxo(2_000_000, 0, before))],
      [loaded],
      [],
      None,
    ),
  )
}

/// CỰC ÂM. Chữ ký vận hành cũng không mua được quyền dời nhà — `Operate` đi qua đúng
/// `shape_ok` như mọi nhánh tiếp-tục khác. Bài dương của cặp này là
/// `operate_may_spend_above_the_reserve`.
test operate_cannot_rehome_the_vault() {
  let state = VaultDatum { collected: 1_000, skimmed: 0 }
  !run(
    state,
    Operate,
    tx(
      [input_from(ref_at(0), vault_utxo(2_000_000, 1_000, state))],
      [rehomed_vault_utxo(2_000_000, 100, state), to(operator_key, 900)],
      [operator_key],
      None,
    ),
  )
}

/// CỰC ÂM. Nhánh `Skim` cũng vậy. Bài dương của cặp là `skim_moves_exactly_the_obligation`
/// — khác đúng phần uỷ quyền của ô kho đi ra.
test skim_cannot_rehome_the_vault() {
  let before = VaultDatum { collected: 1_000, skimmed: 0 }
  let after = VaultDatum { collected: 1_000, skimmed: 100 }
  !run(
    before,
    Skim { amount: 100 },
    tx(
      [input_from(ref_at(0), vault_utxo(2_000_000, 1_000, before))],
      [rehomed_vault_utxo(2_000_000, 900, after), skim_output(100)],
      [],
      None,
    ),
  )
}

/// CỰC ÂM, chiều KHÁC: lần này ô kho đi ra đúng chỗ, nhưng KHOẢN TRÍCH đi tới một địa
/// chỉ dời nhà mang cùng băm kho tạm.
///
/// Hại ở đây nặng hơn dời ô kho: `05_swap_and_donate.mjs` tìm khoản trích bằng
/// `utxosAt(escrowAddress)` và từ chối chạy khi không thấy đúng một UTxO. Nên một khoản
/// trích đậu lệch địa chỉ là một khoản `skimmed` đã ghi vào sổ mà đường nộp kho bạc
/// không với tới — nghĩa vụ coi như đã trả trong sổ, chưa trả trên thực tế.
test skim_cannot_send_the_obligation_to_a_rehomed_escrow() {
  let before = VaultDatum { collected: 1_000, skimmed: 0 }
  let after = VaultDatum { collected: 1_000, skimmed: 100 }
  !run(
    before,
    Skim { amount: 100 },
    tx(
      [input_from(ref_at(0), vault_utxo(2_000_000, 1_000, before))],
      [vault_utxo(2_000_000, 900, after), rehomed_skim_output(100)],
      [],
      None,
    ),
  )
}

/// CỰC ÂM cho phép LỌC, không cho phép so.
///
/// `Close` đòi KHÔNG ô kho nào đi ra. Bài này ghim việc bộ lọc `own_outputs` phải giữ
/// nguyên độ RỘNG (chỉ theo băm script): thu hẹp nó về so-địa-chỉ-đầy-đủ — một việc dọn
/// dẹp nghe rất hợp lý sau khi đọc bản vá ở trên — thì một ô kho dời nhà không còn bị
/// đếm nữa, và `Close` trở thành đường dựng một ô kho mới với sổ bịa ra. Cặp của bài này
/// là `close_rejects_a_continuing_vault_output`.
test close_rejects_a_rehomed_continuing_vault_output() {
  let settled = VaultDatum { collected: 1_000, skimmed: 100 }
  let forged = VaultDatum { collected: 0, skimmed: 0 }
  !run(
    settled,
    Close,
    close_tx(
      [input_from(ref_at(0), vault_utxo(5_000_000, 900, settled))],
      [rehomed_vault_utxo(2_000_000, 900, forged), to(operator_key, 0)],
      [operator_key],
      None,
    ),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// NFT SỔ — MẶT ĐÚC
//
// Ô sổ chỉ nhận ra được bằng NFT, nên mọi thứ về sổ bắt đầu ở lần đúc. Mỗi bài âm
// dưới đây dựng từ khuôn của bài dương ngay đầu và đổi ĐÚNG MỘT thứ.
// ─────────────────────────────────────────────────────────────────────────────

fn run_mint(redeemer: VaultMint, tx_body: Transaction) -> Bool {
  mint_with(skim_bps, listing_window, redeemer, tx_body)
}

fn mint_with(
  bps: Int,
  window: Int,
  redeemer: VaultMint,
  tx_body: Transaction,
) -> Bool {
  fee_vault.mint(
    carp_policy,
    carp_name,
    bps,
    escrow_hash,
    operator_key,
    window,
    seed_ref,
    redeemer,
    vault_hash,
    tx_body,
  )
}

/// Tham số hỏng: cùng giao dịch mở kho như bài dương, khác đúng một tham số biên dịch.
fn open_with(bps: Int, window: Int) -> Bool {
  mint_with(
    bps,
    window,
    Open,
    open_tx([wallet_input(seed_ref)], [opening_output()], one_nft()),
  )
}

test open_rejects_a_zero_skim_rate() {
  !open_with(0, listing_window)
}

test open_rejects_a_skim_rate_above_one_hundred_percent() {
  !open_with(10_001, listing_window)
}

/// Biên trên đúng 100% vẫn mở được — cặp dương của bài trên.
test open_accepts_a_skim_rate_of_exactly_one_hundred_percent() {
  open_with(10_000, listing_window)
}

test open_rejects_a_non_positive_listing_window() {
  !open_with(skim_bps, 0)
}

fn wallet_input(reference: OutputReference) -> Input {
  input_from(
    reference,
    wallet_output(
      from_verification_key(operator_key),
      from_lovelace(10_000_000),
    ),
  )
}

fn empty_ledger() -> VaultDatum {
  VaultDatum { collected: 0, skimmed: 0 }
}

fn opening_output() -> Output {
  script_output(
    vault_hash,
    with_vault_nft(from_lovelace(2_000_000)),
    inline(empty_ledger()),
  )
}

fn open_tx(
  inputs: List<Input>,
  outputs: List<Output>,
  minted: Value,
) -> Transaction {
  Transaction { ..tx(inputs, outputs, [], None), mint: minted }
}

fn one_nft() -> Value {
  from_asset(vault_hash, vault_nft_name, 1)
}

fn stranger_with(value: Value) -> Output {
  wallet_output(from_verification_key(stranger_key), value)
}

/// CỰC DƯƠNG. Tiêu seed, đúc đúng 1 NFT, ô sổ trắng ở địa chỉ enterprise của kho.
test open_mints_exactly_one_nft_to_the_enterprise_vault_address_with_an_empty_ledger() {
  run_mint(
    Open,
    open_tx([wallet_input(seed_ref)], [opening_output()], one_nft()),
  )
}

/// Không tiêu seed thì không mở được: NFT chỉ đúc được một lần cho mỗi instance.
test open_requires_the_seed() {
  !run_mint(
    Open,
    open_tx([wallet_input(ref_at(5))], [opening_output()], one_nft()),
  )
}

/// Đúc 2. Ô sổ vẫn giữ đúng 1 (cái thứ hai ra ví), nên chỉ phép so lượng đúc chặn được.
test open_rejects_minting_two_tokens() {
  !run_mint(
    Open,
    open_tx(
      [wallet_input(seed_ref)],
      [
        opening_output(),
        stranger_with(with_vault_nft(from_lovelace(2_000_000))),
      ],
      from_asset(vault_hash, vault_nft_name, 2),
    ),
  )
}

/// Đúc kèm một tên thứ hai. Tên `zzz` xếp SAU `orilife-fee-vault` — xếp trước thì phép
/// so cặp đầu tiên đã lệch và bài này không còn phân biệt "đúng một tên" với "đúng tên".
test open_rejects_minting_a_second_token_name() {
  !run_mint(
    Open,
    open_tx(
      [wallet_input(seed_ref)],
      [
        opening_output(),
        stranger_with(from_lovelace(2_000_000) |> add(vault_hash, "zzz", 1)),
      ],
      one_nft() |> add(vault_hash, "zzz", 1),
    ),
  )
}

/// Đúc sai tên: ô "sổ" giữ một token không phải NFT sổ.
test open_rejects_a_wrong_token_name() {
  !run_mint(
    Open,
    open_tx(
      [wallet_input(seed_ref)],
      [
        script_output(
          vault_hash,
          from_lovelace(2_000_000) |> add(vault_hash, "not-the-vault", 1),
          inline(empty_ledger()),
        ),
      ],
      from_asset(vault_hash, "not-the-vault", 1),
    ),
  )
}

/// Mở kho kèm CARP là nạp không ghi sổ.
test open_rejects_carp_in_the_opening_output() {
  !run_mint(
    Open,
    open_tx(
      [wallet_input(seed_ref)],
      [
        script_output(
          vault_hash,
          with_vault_nft(value_with_carp(2_000_000, 500)),
          inline(empty_ledger()),
        ),
      ],
      one_nft(),
    ),
  )
}

test open_rejects_a_reference_script_on_the_opening_output() {
  !run_mint(
    Open,
    open_tx(
      [wallet_input(seed_ref)],
      [
        Output {
          ..opening_output(),
          reference_script: Some(
            #"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
          ),
        },
      ],
      one_nft(),
    ),
  )
}

/// Ô sổ mở ở địa chỉ có phần uỷ quyền: kịch bản tìm sổ bằng địa chỉ enterprise sẽ không
/// thấy nó, và phần thưởng uỷ quyền trên ADA giữ chỗ chảy về khoá lạ.
test open_rejects_a_delegated_vault_address() {
  !run_mint(
    Open,
    open_tx(
      [wallet_input(seed_ref)],
      [
        rehomed_script_output(
          vault_hash,
          stranger_key,
          with_vault_nft(from_lovelace(2_000_000)),
          inline(empty_ledger()),
        ),
      ],
      one_nft(),
    ),
  )
}

/// Sổ mở ra với `collected` khác 0 là sổ bịa: nghĩa vụ tính trên một dòng vào chưa từng có.
test open_rejects_a_ledger_that_does_not_start_empty() {
  !run_mint(
    Open,
    open_tx(
      [wallet_input(seed_ref)],
      [
        script_output(
          vault_hash,
          with_vault_nft(from_lovelace(2_000_000)),
          inline(VaultDatum { collected: 500, skimmed: 0 }),
        ),
      ],
      one_nft(),
    ),
  )
}

/// Ô thứ hai ở script kho trong lần mở. Ô hợp lệ đứng TRƯỚC — đảo thứ tự thì bài này đỏ ở
/// các phép so trên ô đầu, không còn ghim việc đòi đúng một ô.
test open_rejects_a_second_output_at_the_vault_script() {
  !run_mint(
    Open,
    open_tx(
      [wallet_input(seed_ref)],
      [
        opening_output(),
        script_output(vault_hash, from_lovelace(2_000_000), NoDatum),
      ],
      one_nft(),
    ),
  )
}

/// NFT ra ví, ô sổ không giữ nó.
test open_rejects_an_opening_output_without_the_nft() {
  !run_mint(
    Open,
    open_tx(
      [wallet_input(seed_ref)],
      [
        script_output(
          vault_hash,
          from_lovelace(2_000_000),
          inline(empty_ledger()),
        ),
        stranger_with(with_vault_nft(from_lovelace(2_000_000))),
      ],
      one_nft(),
    ),
  )
}

test burn_accepts_burning_the_single_nft() {
  run_mint(Burn, open_tx([], [], from_asset(vault_hash, vault_nft_name, -1)))
}

/// Redeemer `Burn` không phải cửa đúc thêm.
test burn_cannot_mint() {
  !run_mint(Burn, open_tx([], [opening_output()], one_nft()))
}

// ─────────────────────────────────────────────────────────────────────────────
// NFT SỔ — MẶT TIÊU
// ─────────────────────────────────────────────────────────────────────────────

test collect_rejects_a_continuing_output_without_the_nft() {
  let before = VaultDatum { collected: 0, skimmed: 0 }
  let after = VaultDatum { collected: 500, skimmed: 0 }
  !run(
    before,
    Collect { amount: 500 },
    tx(
      [input_from(ref_at(0), vault_utxo(2_000_000, 0, before))],
      [bare_vault_utxo(2_000_000, 500, after), stranger_with(one_nft())],
      [],
      None,
    ),
  )
}

test skim_rejects_a_continuing_output_without_the_nft() {
  let before = VaultDatum { collected: 1_000, skimmed: 0 }
  let after = VaultDatum { collected: 1_000, skimmed: 100 }
  !run(
    before,
    Skim { amount: 100 },
    tx(
      [input_from(ref_at(0), vault_utxo(2_000_000, 1_000, before))],
      [
        bare_vault_utxo(2_000_000, 900, after),
        skim_output(100),
        stranger_with(one_nft()),
      ],
      [],
      None,
    ),
  )
}

test operate_rejects_a_continuing_output_without_the_nft() {
  let state = VaultDatum { collected: 1_000, skimmed: 0 }
  !run(
    state,
    Operate,
    tx(
      [input_from(ref_at(0), vault_utxo(2_000_000, 1_000, state))],
      [
        bare_vault_utxo(2_000_000, 100, state),
        wallet_output(
          from_verification_key(operator_key),
          with_vault_nft(value_with_carp(2_000_000, 900)),
        ),
      ],
      [operator_key],
      None,
    ),
  )
}

/// Đóng kho mà không đốt: NFT ra ví vận hành, còn sống để gắn vào một sổ bịa.
test close_requires_the_burn() {
  let settled = VaultDatum { collected: 1_000, skimmed: 100 }
  !run(
    settled,
    Close,
    tx(
      [input_from(ref_at(0), vault_utxo(5_000_000, 900, settled))],
      [
        wallet_output(
          from_verification_key(operator_key),
          with_vault_nft(value_with_carp(2_000_000, 900)),
        ),
      ],
      [operator_key],
      None,
    ),
  )
}

/// Một UTxO ở địa chỉ kho mang datum đúng khuôn sổ — sổ "trắng", nên nghĩa vụ bằng 0 và
/// `Operate` sẽ cho rút hết — nhưng KHÔNG giữ NFT. Nó không được đóng vai sổ.
test a_fake_vault_utxo_with_a_forged_datum_but_no_nft_cannot_act_as_the_ledger() {
  let forged = VaultDatum { collected: 0, skimmed: 0 }
  let raw: Data = forged
  !run_at(
    ref_at(0),
    Some(raw),
    Operate,
    tx(
      [input_from(ref_at(0), bare_vault_utxo(2_000_000, 1_000, forged))],
      [to(operator_key, 1_000)],
      [operator_key],
      None,
    ),
  )
}

fn stray_sweep(ledger_gain: Int, stray: Output) -> Transaction {
  tx(
    [
      input_from(ref_at(0), vault_utxo(2_000_000, 0, empty_ledger())),
      input_from(ref_at(1), stray),
    ],
    [
      vault_utxo(
        2_000_000,
        ledger_gain,
        VaultDatum { collected: ledger_gain, skimmed: 0 },
      ),
      stranger_with(from_lovelace(3_000_000)),
    ],
    [],
    None,
  )
}

/// CỰC DƯƠNG. UTxO gửi nhầm không datum, mang 100 CARP: gom được vào `Collect`, CARP vào
/// sổ, lovelace của nó về người gom. Cả hai lượt chạy (ô sổ và ô lạc) đều qua.
test a_stray_datumless_utxo_is_swept_into_collect_with_its_carp_recorded() {
  let sweep = stray_sweep(100, stray_utxo(100))
  and {
    run(empty_ledger(), Collect { amount: 100 }, sweep),
    run_at(ref_at(1), None, Collect { amount: 100 }, sweep),
  }
}

/// Datum lạ cũng vậy: datum của đầu vào lạc không bao giờ được đọc.
test a_stray_utxo_with_a_foreign_datum_is_also_sweepable() {
  let foreign: Data = 42
  let stray =
    script_output(vault_hash, value_with_carp(3_000_000, 100), inline(foreign))
  run_at(
    ref_at(1),
    Some(foreign),
    Collect { amount: 100 },
    stray_sweep(100, stray),
  )
}

/// Phía ô sổ: sổ chỉ ghi 50 trong khi đầu vào lạc mang 100.
test collect_must_record_the_carp_of_stray_inputs() {
  !run(empty_ledger(), Collect { amount: 50 }, stray_sweep(50, stray_utxo(100)))
}

/// Phía ô lạc: cùng giao dịch, kiểm từ lượt chạy của chính ô lạc.
test a_stray_input_rejects_a_ledger_gain_below_its_carp() {
  !run_at(
    ref_at(1),
    None,
    Collect { amount: 50 },
    stray_sweep(50, stray_utxo(100)),
  )
}

/// CARP lạc không ra theo `Operate`. Ô sổ giữ đúng như bài dương
/// `operate_may_spend_above_the_reserve`; khác đúng một ô lạc 100 CARP đi ra ví vận hành.
test stray_carp_cannot_leave_via_operate() {
  let state = VaultDatum { collected: 1_000, skimmed: 0 }
  !run(
    state,
    Operate,
    tx(
      [
        input_from(ref_at(0), vault_utxo(2_000_000, 1_000, state)),
        input_from(ref_at(1), stray_utxo(100)),
      ],
      [vault_utxo(2_000_000, 100, state), to(operator_key, 1_000)],
      [operator_key],
      None,
    ),
  )
}

/// CARP lạc không ra theo `Skim`. Ô sổ và khoản trích đúng như bài dương
/// `skim_moves_exactly_the_obligation`; khác đúng một ô lạc 100 CARP đi ra ví lạ.
test stray_carp_cannot_leave_via_skim() {
  let before = VaultDatum { collected: 1_000, skimmed: 0 }
  let after = VaultDatum { collected: 1_000, skimmed: 100 }
  !run(
    before,
    Skim { amount: 100 },
    tx(
      [
        input_from(ref_at(0), vault_utxo(2_000_000, 1_000, before)),
        input_from(ref_at(1), stray_utxo(100)),
      ],
      [
        vault_utxo(2_000_000, 900, after),
        skim_output(100),
        to(stranger_key, 100),
      ],
      [],
      None,
    ),
  )
}

/// Ô lạc đi một mình (không có ô sổ) thì không tiêu được.
test a_stray_input_needs_the_ledger_input() {
  !run_at(
    ref_at(1),
    None,
    Collect { amount: 100 },
    tx(
      [input_from(ref_at(1), stray_utxo(100))],
      [to(stranger_key, 100)],
      [],
      None,
    ),
  )
}

/// Ô lạc đi cùng một lần đóng kho thì không tiêu được: không còn ô sổ nào đi ra để ghi.
test a_stray_input_needs_the_ledger_to_continue() {
  let settled = VaultDatum { collected: 1_000, skimmed: 100 }
  !run_at(
    ref_at(1),
    None,
    Close,
    close_tx(
      [
        input_from(ref_at(0), vault_utxo(5_000_000, 900, settled)),
        input_from(ref_at(1), stray_utxo(0)),
      ],
      [to(operator_key, 900)],
      [operator_key],
      None,
    ),
  )
}

/// Hai đầu vào giữ NFT. Không xảy ra được trên chuỗi (tổng cung 1), nên đây là bài ghim
/// phòng thủ cho phép đếm `ledger_inputs`: gỡ phép đếm thì bài này phải đỏ.
test two_ledger_inputs_are_rejected() {
  let before = VaultDatum { collected: 0, skimmed: 0 }
  let after = VaultDatum { collected: 500, skimmed: 0 }
  !run(
    before,
    Collect { amount: 500 },
    tx(
      [
        input_from(ref_at(0), vault_utxo(2_000_000, 0, before)),
        input_from(ref_at(1), vault_utxo(2_000_000, 0, before)),
      ],
      [vault_utxo(2_000_000, 500, after)],
      [],
      None,
    ),
  )
}

/// Cùng ca phòng thủ, từ phía ô lạc. Ô sổ ĐẦU TIÊN cho phần tăng đủ phủ ô lạc — nên bài
/// chỉ đỏ vì đòi đúng một ô sổ, không vì phép so phần tăng.
test a_stray_input_rejects_two_ledger_inputs() {
  !run_at(
    ref_at(2),
    None,
    Collect { amount: 100 },
    tx(
      [
        input_from(ref_at(0), vault_utxo(2_000_000, 0, empty_ledger())),
        input_from(ref_at(1), vault_utxo(2_000_000, 0, empty_ledger())),
        input_from(ref_at(2), stray_utxo(100)),
      ],
      [vault_utxo(2_000_000, 100, VaultDatum { collected: 100, skimmed: 0 })],
      [],
      None,
    ),
  )
}

/// Hai đầu ra giữ NFT (phòng thủ). Ô ĐẦU TIÊN cho phần tăng đủ — bài chỉ đỏ vì đòi đúng
/// một ô sổ đi ra.
test a_stray_input_rejects_two_ledger_outputs() {
  !run_at(
    ref_at(1),
    None,
    Collect { amount: 100 },
    tx(
      [
        input_from(ref_at(0), vault_utxo(2_000_000, 0, empty_ledger())),
        input_from(ref_at(1), stray_utxo(100)),
      ],
      [
        vault_utxo(2_000_000, 100, VaultDatum { collected: 100, skimmed: 0 }),
        vault_utxo(2_000_000, 0, empty_ledger()),
      ],
      [],
      None,
    ),
  )
}

/// Đầu vào ở `fee_inbox` không phải việc của kho: kho chỉ đếm đầu vào ở script mình.
test collect_accepts_inbox_inputs_alongside_the_ledger() {
  run(
    empty_ledger(),
    Collect { amount: 100 },
    tx(
      [
        input_from(ref_at(0), vault_utxo(2_000_000, 0, empty_ledger())),
        input_from(
          ref_at(1),
          script_output(inbox_hash, value_with_carp(2_000_000, 100), NoDatum),
        ),
      ],
      [vault_utxo(2_000_000, 100, VaultDatum { collected: 100, skimmed: 0 })],
      [],
      None,
    ),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MỐC MỞ PHIÊN ĐẤU GIÁ Ở `Skim`
//
// Khuôn chung: thu 1000, trích 100, khoản trích khai `listed_at` theo tham số. Bài dương
// `skim_moves_exactly_the_obligation` là cùng khuôn với khoảng hiệu lực mặc định.
// ─────────────────────────────────────────────────────────────────────────────

fn skim_in(window: Int, range, listed_at: Int) -> Bool {
  let before = VaultDatum { collected: 1_000, skimmed: 0 }
  let after = VaultDatum { collected: 1_000, skimmed: 100 }
  let raw: Data = before
  spend_with(
    window,
    ref_at(0),
    Some(raw),
    Skim { amount: 100 },
    Transaction {
      ..tx(
        [input_from(ref_at(0), vault_utxo(2_000_000, 1_000, before))],
        [
          vault_utxo(2_000_000, 900, after),
          script_output(
            escrow_hash,
            value_with_carp(2_000_000, 100),
            inline(escrow_datum(100, None, listed_at)),
          ),
        ],
        [],
        None,
      ),
      validity_range: range,
    },
  )
}

/// Lùi mốc về cận dưới: phiên đấu giá bắt đầu sớm hơn được phép.
test skim_rejects_listed_at_below_the_upper_bound() {
  !skim_in(
    listing_window,
    interval.between(now_ms, now_ms + tx_window_ms),
    now_ms,
  )
}

/// Đẩy mốc quá cận trên một mili-giây: kéo dài thời gian giá đứng ở trần.
test skim_rejects_listed_at_above_the_upper_bound() {
  !skim_in(
    listing_window,
    interval.between(now_ms, now_ms + tx_window_ms),
    now_ms + tx_window_ms + 1,
  )
}

/// CỰC DƯƠNG cho phép so độ rộng: rộng ĐÚNG bằng cửa sổ thì qua.
test skim_accepts_a_range_exactly_as_wide_as_the_listing_window() {
  skim_in(
    listing_window,
    interval.between(now_ms, now_ms + listing_window),
    now_ms + listing_window,
  )
}

/// Rộng hơn cửa sổ một mili-giây: mốc có thể nằm xa "bây giờ" hơn mức cho phép.
test skim_rejects_a_range_wider_than_the_listing_window() {
  !skim_in(
    listing_window,
    interval.between(now_ms, now_ms + listing_window + 1),
    now_ms + listing_window + 1,
  )
}

/// Cận trên để ngỏ: không có giá trị nào để neo mốc vào.
test skim_rejects_an_open_ended_range() {
  !skim_in(listing_window, interval.after(now_ms), now_ms + tx_window_ms)
}

/// Cận dưới để ngỏ: độ rộng không đo được.
test skim_rejects_an_unbounded_lower_end() {
  !skim_in(
    listing_window,
    interval.before(now_ms + tx_window_ms),
    now_ms + tx_window_ms,
  )
}

/// Cửa sổ 0 là tham số hỏng: khoảng một điểm thì mốc vẫn khớp cận trên, nên chỉ phép so
/// `listing_window_ms > 0` chặn được.
test skim_rejects_a_non_positive_listing_window() {
  !skim_in(0, interval.between(now_ms, now_ms), now_ms)
}

// ─────────────────────────────────────────────────────────────────────────────
// NGÂN SÁCH. Hai bài đi cặp: bài "chỉ dựng" đo chi phí dựng giao dịch giả, bài kia đo
// dựng + chạy. Hiệu hai con số là chi phí của validator kho trong một lần gom 20 ô inbox.
// ─────────────────────────────────────────────────────────────────────────────

fn sweep_of(n: Int) -> Transaction {
  tx(
    [
      input_from(ref_at(0), vault_utxo(2_000_000, 0, empty_ledger())),
      ..list.map(
        list.range(1, n),
        fn(i) {
          input_from(
            ref_at(i),
            script_output(inbox_hash, value_with_carp(2_000_000, 100), NoDatum),
          )
        },
      )
    ],
    [
      vault_utxo(
        2_000_000,
        100 * n,
        VaultDatum { collected: 100 * n, skimmed: 0 },
      ),
    ],
    [],
    None,
  )
}

test budget_vault_sweep_of_20_build_only() {
  list.length(sweep_of(20).inputs) == 21
}

test budget_vault_sweep_of_20_collect() {
  run(empty_ledger(), Collect { amount: 2_000 }, sweep_of(20))
}

test budget_vault_sweep_of_50_build_only() {
  list.length(sweep_of(50).inputs) == 51
}

test budget_vault_sweep_of_50_collect() {
  run(empty_ledger(), Collect { amount: 5_000 }, sweep_of(50))
}

// ─────────────────────────────────────────────────────────────────────────────
// ĐỢT SỬA R11-d. `Collect` đếm CARP của MỌI đầu vào script, không chỉ ô lạc của kho.
// ─────────────────────────────────────────────────────────────────────────────

/// Băm của một phiên bản hộp thư THỨ HAI cùng trỏ vào kho này (khác mã ⟹ khác băm).
const inbox2_hash: ByteArray =
  #"88888888888888888888888888888888888888888888888888888888"

/// Băm một script bất kỳ, không liên quan tới kho hay hộp thư.
const foreign_hash: ByteArray =
  #"77777777777777777777777777777777777777777777777777777777"

/// Gom 100 CARP từ hộp thư `inbox_hash` và 100 CARP từ hộp thư `inbox2_hash` cùng lúc;
/// sổ tăng `gain`, người gom cầm `200 − gain` CARP.
fn two_inbox_sweep(gain: Int) -> Transaction {
  let inputs =
    [
      vault_utxo(2_000_000, 0, empty_ledger()),
      script_output(inbox_hash, value_with_carp(2_000_000, 100), NoDatum),
      script_output(inbox2_hash, value_with_carp(2_000_000, 100), NoDatum),
    ]
  Transaction {
    ..tx(
      list.indexed_map(inputs, fn(i, o) { input_from(ref_at(i), o) }),
      [
        vault_utxo(2_000_000, gain, VaultDatum { collected: gain, skimmed: 0 }),
        stranger_with(value_with_carp(4_000_000, 200 - gain)),
      ],
      [],
      None,
    ),
    withdrawals: [Pair(Script(inbox_hash), 0), Pair(Script(inbox2_hash), 0)],
  }
}

/// CỰC ÂM — PoC của lỗ "hai phiên bản hộp thư". Mỗi `withdraw` của hộp thư chỉ đòi sổ
/// tăng ≥ 100 (CARP của chính nó) nên cả hai qua; kho phải là nơi chặn.
test r11d_two_inbox_versions_cannot_share_one_ledger_gain() {
  !run(empty_ledger(), Collect { amount: 100 }, two_inbox_sweep(100))
}

/// Thiếu 1 đơn vị so với tổng hai hộp thư: bác.
test r11d_two_inbox_versions_reject_a_gain_one_below_the_total() {
  !run(empty_ledger(), Collect { amount: 199 }, two_inbox_sweep(199))
}

/// CỰC DƯƠNG: sổ tăng bằng tổng cả hai hộp thư thì qua.
test r11d_two_inbox_versions_pass_when_the_ledger_records_both() {
  run(empty_ledger(), Collect { amount: 200 }, two_inbox_sweep(200))
}

/// Ô sổ + một hộp thư 100 + một script lạ 50 CARP; sổ tăng `gain`.
fn foreign_sweep(gain: Int) -> Transaction {
  let inputs =
    [
      vault_utxo(2_000_000, 0, empty_ledger()),
      script_output(inbox_hash, value_with_carp(2_000_000, 100), NoDatum),
      script_output(foreign_hash, value_with_carp(2_000_000, 50), NoDatum),
    ]
  tx(
    list.indexed_map(inputs, fn(i, o) { input_from(ref_at(i), o) }),
    [
      vault_utxo(2_000_000, gain, VaultDatum { collected: gain, skimmed: 0 }),
      stranger_with(value_with_carp(4_000_000, 150 - gain)),
    ],
    [],
    None,
  )
}

/// CARP của một script lạ bất kỳ đi qua `Collect` cũng phải vào sổ.
test r11d_collect_must_record_the_carp_of_any_script_input() {
  !run(empty_ledger(), Collect { amount: 100 }, foreign_sweep(100))
}

test r11d_collect_passes_when_any_script_input_is_recorded() {
  run(empty_ledger(), Collect { amount: 150 }, foreign_sweep(150))
}

/// Đầu vào VÍ không bị đếm: người nộp mang 100 CARP từ ví, chỉ nộp 30, giữ 70 tiền thối.
test r11d_wallet_inputs_are_not_counted() {
  run(
    empty_ledger(),
    Collect { amount: 30 },
    tx(
      [
        input_from(ref_at(0), vault_utxo(2_000_000, 0, empty_ledger())),
        input_from(
          ref_at(1),
          wallet_output(
            from_verification_key(stranger_key),
            value_with_carp(2_000_000, 100),
          ),
        ),
      ],
      [
        vault_utxo(2_000_000, 30, VaultDatum { collected: 30, skimmed: 0 }),
        stranger_with(value_with_carp(2_000_000, 70)),
      ],
      [],
      None,
    ),
  )
}
