//// Quỹ nộp kho bạc theo epoch: một UTxO giữ ADA, và MỖI epoch tối đa một lần, bất kỳ ai cũng
//// đẩy được ít nhất `per_epoch` lovelace từ quỹ vào kho bạc Cardano (trường `treasury_donation`
//// của thân giao dịch, Conway). Không ai cần chữ ký để nộp — người góp quỹ biến mất thì lời hứa
//// vẫn chạy, chỉ cần một người bất kỳ chịu trả phí giao dịch.
////
//// Hai lối ra, không có lối thứ ba:
////   · `Donate` — ai cũng gọi; nộp kho bạc, ô quỹ đi tiếp với `last_epoch` = epoch hiện tại.
////   · `Reclaim` — ai cũng gọi, KHÔNG cần chữ ký, CHỈ khi quỹ đã nằm yên `idle_epochs` epoch
////     (luật "không khoá ADA vĩnh viễn": mất khoá chủ quỹ không được khoá ADA mãi). Toàn bộ
////     lovelace về địa chỉ khoá bởi `owner`; NFT quỹ phải bị đốt cùng lượt.
////
//// ─────────────────────────────────────────────────────────────────────────────
//// QUYẾT ĐỊNH THIẾT KẾ — đọc trước khi sửa.
////
//// 1. Thông số epoch (`epoch_zero_ms`, `epoch_length_ms`) là THAM SỐ, không nằm trong datum.
////    Chúng là hằng số của mạng chứ không phải của một quỹ; đặt vào tham số thì băm script
////    (tức địa chỉ) cam kết luôn lịch epoch, ai đọc địa chỉ cũng biết quỹ đếm epoch theo
////    lịch nào, datum nhỏ hơn, và `Open` khỏi phải kiểm hai con số đó có hợp lệ không.
////
//// 2. NFT trạng thái đúc MỘT LẦN từ `seed` (tham số), chính sách = băm chính validator này.
////    Địa chỉ script là chỗ ai cũng gửi vào được, kèm datum tự đặt; "ô ở địa chỉ quỹ" không
////    nhận ra được quỹ thật. "Ô giữ NFT" thì nhận ra được: `seed` bị tiêu lúc mở quỹ nên
////    không giao dịch nào đúc được NFT thứ hai, và `mint` kiểm datum + giá trị của ô quỹ
////    lúc đúc, nên datum của ô giữ NFT là datum ĐÃ XÁC THỰC — không phải lời khai của người
////    gửi. `Donate` đòi ô đang tiêu giữ NFT; ô rác không có NFT thì `Donate` không đụng tới.
////
//// 3. `treasury_donation` là một con số cho CẢ giao dịch, không ghi nguồn. Nên `Donate` đòi
////    giao dịch có ĐÚNG MỘT redeemer (bài học `donation_escrow`): không script Plutus nào
////    khác — kể cả một quỹ khác cùng mã, khác `seed` — đọc chung khoản nộp đó. Câu này cũng
////    chặn luôn double-satisfaction giữa hai quỹ.
////
//// 4. Epoch hiện tại suy từ CẬN DƯỚI khoảng hiệu lực (bắt buộc hữu hạn); CẬN TRÊN cũng bắt
////    buộc hữu hạn và phải rơi vào CÙNG epoch. Sổ cái không cho cận dưới vượt thời điểm thật
////    và không cho cận trên lùi trước thời điểm thật, nên hai câu đó ghim "epoch hiện tại"
////    đúng bằng epoch thật — không khai được epoch tương lai để nộp trước. Cận trên so theo
////    giá trị thô, không trừ 1 khi bound là mở: chặt hơn một mili-giây ở mép epoch, đổi lại
////    không có chỗ nào phải suy luận về tính mở/đóng của bound.
////
//// 5. Quỹ cạn: `Donate` LUÔN đòi một ô quỹ đi tiếp, và sổ cái đòi ô đó có min-ADA. Khi quỹ
////    còn dưới `per_epoch` + min-ADA, người gọi phải tự bù phần thiếu từ ví mình (luật đòi
////    `lovelace ra >= lovelace vào − per_epoch`, không cấm bơm thêm) — tức quỹ không tự nộp
////    được nữa. Phần còn lại (cỡ min-ADA) về `owner` bằng `Reclaim` sau `idle_epochs` epoch.
////    Không có nhánh "nộp nốt rồi đóng quỹ": thêm nhánh đó là thêm một lối ra cho NFT.
////
//// 6. Mỗi lượt `Donate` quỹ mất TỐI ĐA `per_epoch`, và khoản nộp kho bạc phải `>= per_epoch`:
////    phần rời quỹ luôn được khoản nộp phủ trọn (cùng câu "đúng một redeemer" ở mục 3, không
////    script nào khác chia khoản đó). Ai muốn nộp nhiều hơn thì tự bỏ phần dư từ ví mình —
////    người lạ không rút cạn được quỹ trong một epoch.
//// ─────────────────────────────────────────────────────────────────────────────

use aiken/collection/dict
use aiken/collection/list
use aiken/interval.{Finite, Interval, IntervalBound}
use cardano/address.{
  Address, Script, VerificationKey, from_script, with_delegation_key,
}
use cardano/assets.{
  AssetName, PolicyId, Value, add, from_asset, from_lovelace, lovelace_of,
  quantity_of, tokens, without_lovelace,
}
use cardano/transaction.{
  InlineDatum, Input, Mint, NoDatum, Output, OutputReference, Redeemer,
  ScriptPurpose, Spend, Transaction, find_input, placeholder,
}

/// Tên NFT quỹ. Chính sách = băm validator này, nên tên chỉ cần phân biệt trong nội bộ.
/// Kịch bản ngoài chuỗi dùng đúng chuỗi byte này (`08_epoch_donation.mjs` ▸ `FUND_NFT_NAME`).
pub const fund_nft_name: AssetName = "epoch-donation"

/// Trạng thái quỹ. Mọi trường trừ `last_epoch` là BẤT BIẾN suốt đời quỹ: `Donate` đòi datum ra
/// giống hệt datum vào ngoài `last_epoch`.
pub type EpochDonationDatum {
  /// Epoch gần nhất đã nộp. `Donate` chỉ chạy khi epoch hiện tại lớn hơn số này. Lúc mở quỹ
  /// bắt buộc = epoch mở − 1, để nộp được ngay trong epoch mở và để `Reclaim` không tính
  /// thời gian nằm yên từ một mốc khai lùi về quá khứ.
  last_epoch: Int,
  /// Mức nộp tối thiểu mỗi epoch (lovelace). Lớn hơn 0.
  per_epoch: Int,
  /// Băm khoá thanh toán của bên nhận lại quỹ. Chỉ dùng ở `Reclaim` (đích trả tiền, KHÔNG
  /// phải chữ ký bắt buộc).
  owner: ByteArray,
  /// Số epoch nằm yên (không ai `Donate`) để chủ quỹ được thu hồi. Lớn hơn 0.
  idle_epochs: Int,
}

pub type EpochDonationRedeemer {
  Donate
  Reclaim
}

validator epoch_donation(
  /// UTxO bị tiêu lúc mở quỹ. Làm NFT quỹ thành đúc-một-lần.
  seed: OutputReference,
  /// Thời điểm (POSIX ms) bắt đầu epoch 0 của mạng.
  epoch_zero_ms: Int,
  /// Độ dài một epoch (ms). Preprod và Mainnet: 432 000 000 (5 ngày) — kịch bản đọc từ
  /// Blockfrost chứ không chép hằng số này.
  epoch_length_ms: Int,
) {
  mint(_redeemer: Data, policy_id: PolicyId, tx: Transaction) {
    when dict.to_pairs(tokens(tx.mint, policy_id)) is {
      [Pair(name, quantity)] ->
        if quantity == 1 {
          and {
            // MUT:M_NAME
            name == fund_nft_name,
            opens_fund(policy_id, tx, seed, epoch_zero_ms, epoch_length_ms),
          }
        } else {
          and {
            // MUT:M_BURN_ONLY
            quantity == -1,
            // MUT:M_BURN_NAME
            name == fund_nft_name,
          }
        }
      _ -> False
    }
  }

  spend(
    datum: Option<EpochDonationDatum>,
    redeemer: EpochDonationRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(fund) = datum
    expect Some(own_input) = find_input(tx.inputs, own_ref)
    expect Script(own_hash) = own_input.output.address.payment_credential
    // Chính sách NFT = băm của chính script này (validator hai mặt mint + spend).
    let has_nft =
      quantity_of(own_input.output.value, own_hash, fund_nft_name) == 1

    when redeemer is {
      Donate -> {
        let lower =
          when tx.validity_range.lower_bound.bound_type is {
            Finite(t) -> t
            // MUT:D_LOWER_FINITE
            _ -> fail
          }
        let upper =
          when tx.validity_range.upper_bound.bound_type is {
            Finite(t) -> t
            // MUT:D_UPPER_FINITE
            _ -> fail
          }
        let current = epoch_at(lower, epoch_zero_ms, epoch_length_ms)
        // MỌI output chạy script này, lọc theo băm chứ không theo địa chỉ đầy đủ: cố ý rộng
        // để không đầu ra nào thoát tầm soát bằng cách đổi phần uỷ quyền. Phải có đúng một.
        // MUT:D_ONE_OUTPUT
        expect [next] =
          list.filter(
            tx.outputs,
            fn(output) { output.address.payment_credential == Script(own_hash) },
          )
        expect InlineDatum(raw_next) = next.datum
        expect next_datum: EpochDonationDatum = raw_next

        and {
          // MUT:D_ONE_REDEEMER
          list.length(tx.redeemers) == 1,
          // MUT:D_NFT
          has_nft,
          // MUT:D_NEW_EPOCH
          current > fund.last_epoch,
          // MUT:D_UPPER_SAME_EPOCH
          epoch_at(upper, epoch_zero_ms, epoch_length_ms) == current,
          // MUT:D_DONATION
          donation_at_least(tx, fund.per_epoch),
          // MUT:D_ADDRESS
          next.address == own_input.output.address,
          // MUT:D_DATUM
          next_datum == EpochDonationDatum { ..fund, last_epoch: current },
          // MUT:D_TOKENS
          without_lovelace(next.value) == without_lovelace(
            own_input.output.value,
          ),
          // MUT:D_LOVELACE
          lovelace_of(next.value) >= lovelace_of(own_input.output.value) - fund.per_epoch,
          // MUT:D_REF_SCRIPT
          next.reference_script == None,
        }
      }

      Reclaim -> {
        // Lovelace trả về `owner`: cộng MỌI output có phần thanh toán là khoá `owner` (phần uỷ
        // quyền tuỳ ý). Người nộp giao dịch trả phí từ input của mình, nên `owner` nhận đủ.
        let paid_to_owner =
          list.foldl(
            tx.outputs,
            0,
            fn(output, total) {
              if output.address.payment_credential == VerificationKey(
                fund.owner,
              ) {
                total + lovelace_of(output.value)
              } else {
                total
              }
            },
          )
        // Ô quỹ thật: một redeemer tiêu + một redeemer đốt. Ô rác: chỉ redeemer tiêu. Không
        // script Plutus nào khác trong giao dịch ⟹ một output trả `owner` không thoả được cho
        // hai ô (double satisfaction giữa hai quỹ cùng `owner`).
        let script_count =
          if has_nft {
            2
          } else {
            1
          }
        and {
          // MUT:R_ONE_SCRIPT
          list.length(tx.redeemers) == script_count,
          // MUT:R_PAID
          paid_to_owner >= lovelace_of(own_input.output.value),
          // Ô rác (không NFT) do người gửi tự đặt `owner`: chỉ trả được về đúng `owner` đó.
          // Ô quỹ thật thì phải nằm yên đủ lâu, và NFT phải bị đốt — NFT sống sót qua `Reclaim`
          // là NFT đi được tới một ô quỹ giả mang datum tuỳ ý.
          if has_nft {
            let lower =
              when tx.validity_range.lower_bound.bound_type is {
                Finite(t) -> t
                // MUT:R_LOWER_FINITE
                _ -> fail
              }
            and {
              // MUT:R_IDLE
              epoch_at(lower, epoch_zero_ms, epoch_length_ms) >= fund.last_epoch + fund.idle_epochs,
              // MUT:R_BURN
              quantity_of(tx.mint, own_hash, fund_nft_name) == -1,
            }
          } else {
            True
          },
        }
      }
    }
  }

  else(_) {
    fail
  }
}

/// Epoch chứa thời điểm `t`. Chia nguyên của Aiken là chia sàn, nên `t` trước mốc 0 ra số âm.
fn epoch_at(t: Int, epoch_zero_ms: Int, epoch_length_ms: Int) -> Int {
  ( t - epoch_zero_ms ) / epoch_length_ms
}

fn donation_at_least(tx: Transaction, required: Int) -> Bool {
  when tx.treasury_donation is {
    Some(donated) -> donated >= required
    None -> False
  }
}

/// Mở quỹ: tiêu `seed`, và ô DUY NHẤT nhận NFT là một ô quỹ hợp lệ tại địa chỉ gốc của script.
fn opens_fund(
  policy_id: PolicyId,
  tx: Transaction,
  seed: OutputReference,
  epoch_zero_ms: Int,
  epoch_length_ms: Int,
) -> Bool {
  // Đúc đúng 1 nên chỉ một output mang được NFT; lọc theo NFT để lấy ô quỹ.
  expect [fund_output] =
    list.filter(
      tx.outputs,
      fn(output) { quantity_of(output.value, policy_id, fund_nft_name) > 0 },
    )
  expect InlineDatum(raw) = fund_output.datum
  expect fund: EpochDonationDatum = raw
  let lower =
    when tx.validity_range.lower_bound.bound_type is {
      Finite(t) -> t
      _ -> fail
    }
  let upper =
    when tx.validity_range.upper_bound.bound_type is {
      Finite(t) -> t
      _ -> fail
    }
  let opened_in = epoch_at(lower, epoch_zero_ms, epoch_length_ms)
  and {
    // MUT:M_SEED
    list.any(tx.inputs, fn(input) { input.output_reference == seed }),
    // Địa chỉ gốc, không phần uỷ quyền: một địa chỉ cho mỗi quỹ, `utxosAt` của kịch bản thấy nó.
    // MUT:M_ADDRESS
    fund_output.address == from_script(policy_id),
    // Chỉ ADA + NFT: không token rác làm phình ô quỹ.
    // MUT:M_VALUE
    without_lovelace(fund_output.value) == from_asset(
      policy_id,
      fund_nft_name,
      1,
    ),
    // MUT:M_REF_SCRIPT
    fund_output.reference_script == None,
    // MUT:M_LENGTH
    epoch_length_ms > 0,
    // MUT:M_PER_EPOCH
    fund.per_epoch > 0,
    // MUT:M_IDLE
    fund.idle_epochs > 0,
    // MUT:M_AFTER_ZERO
    lower >= epoch_zero_ms,
    // MUT:M_UPPER_SAME_EPOCH
    epoch_at(upper, epoch_zero_ms, epoch_length_ms) == opened_in,
    // MUT:M_LAST_EPOCH
    fund.last_epoch == opened_in - 1,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bài kiểm. Mỗi bài âm chỉ phá ĐÚNG một chốt; mọi chốt khác của nhánh vẫn thoả, để bài đỏ
// vì đúng chốt nó mang tên (đã kiểm bằng đột biến — xem `onchain/README.md`).
// ─────────────────────────────────────────────────────────────────────────────

const t_zero: Int = 1_654_041_600_000

const t_length: Int = 432_000_000

/// Epoch của mọi giao dịch mặc định trong bài kiểm.
const t_epoch: Int = 100

const t_seed: OutputReference =
  OutputReference {
    transaction_id: #"5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed",
    output_index: 0,
  }

const fund_hash: ByteArray =
  #"fd00fd00fd00fd00fd00fd00fd00fd00fd00fd00fd00fd00fd00fd00"

const other_fund_hash: ByteArray =
  #"0fd00fd00fd00fd00fd00fd00fd00fd00fd00fd00fd00fd00fd00fd0"

const owner_key: ByteArray =
  #"00a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"

const stranger: ByteArray =
  #"00b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2"

const one_ada: Int = 1_000_000

/// Một thời điểm giữa epoch `e` (cách đầu epoch 1 giờ).
fn mid_epoch(e: Int) -> Int {
  t_zero + e * t_length + 3_600_000
}

fn range(lower: Int, upper: Int) -> Interval {
  interval.between(lower, upper)
}

fn fund_datum(last_epoch: Int) -> EpochDonationDatum {
  EpochDonationDatum {
    last_epoch,
    per_epoch: one_ada,
    owner: owner_key,
    idle_epochs: 10,
  }
}

fn fund_value(lovelace: Int) -> Value {
  from_lovelace(lovelace) |> add(fund_hash, fund_nft_name, 1)
}

fn fund_output(lovelace: Int, datum: EpochDonationDatum) -> Output {
  Output {
    address: from_script(fund_hash),
    value: fund_value(lovelace),
    datum: InlineDatum(datum),
    reference_script: None,
  }
}

fn fund_ref() -> OutputReference {
  OutputReference {
    transaction_id: #"f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0",
    output_index: 0,
  }
}

fn own_redeemer(r: EpochDonationRedeemer) -> Pair<ScriptPurpose, Redeemer> {
  let as_data: Data = r
  Pair(Spend(fund_ref()), as_data)
}

fn wallet(key: ByteArray, lovelace: Int) -> Output {
  Output {
    address: address.from_verification_key(key),
    value: from_lovelace(lovelace),
    datum: NoDatum,
    reference_script: None,
  }
}

/// Giao dịch `Donate` mặc định: quỹ 10 ADA, `last_epoch = t_epoch − 1`, nộp đúng 1 ADA trong
/// epoch `t_epoch`, ô quỹ đi tiếp với 9 ADA và datum đã nâng `last_epoch`.
fn donate_tx(
  input: Output,
  outputs: List<Output>,
  donation: Option<Int>,
  validity: Interval,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [Input { output_reference: fund_ref(), output: input }],
    outputs,
    treasury_donation: donation,
    validity_range: validity,
    redeemers,
  }
}

fn default_window() -> Interval {
  range(mid_epoch(t_epoch), mid_epoch(t_epoch) + 600_000)
}

fn run_donate(datum: EpochDonationDatum, input: Output, tx: Transaction) -> Bool {
  epoch_donation.spend(
    t_seed,
    t_zero,
    t_length,
    Some(datum),
    Donate,
    fund_ref(),
    tx,
  )
}

fn good_donate_with(
  outputs: List<Output>,
  donation: Option<Int>,
  validity: Interval,
) -> Bool {
  let datum = fund_datum(t_epoch - 1)
  let input = fund_output(10 * one_ada, datum)
  run_donate(
    datum,
    input,
    donate_tx(input, outputs, donation, validity, [own_redeemer(Donate)]),
  )
}

fn next_ok() -> Output {
  fund_output(9 * one_ada, fund_datum(t_epoch))
}

test donate_passes_once_per_epoch() {
  good_donate_with([next_ok()], Some(one_ada), default_window())
}

test donate_passes_when_the_caller_tops_up_the_fund() {
  good_donate_with(
    [fund_output(11 * one_ada, fund_datum(t_epoch))],
    Some(one_ada),
    default_window(),
  )
}

/// Người lạ không rút cạn quỹ: khoản nộp 8 ADA không cho quỹ mất quá `per_epoch`.
test donate_fails_when_the_fund_pays_more_than_per_epoch() fail {
  good_donate_with(
    [fund_output(2 * one_ada, fund_datum(t_epoch))],
    Some(8 * one_ada),
    default_window(),
  )
}

/// Nộp hơn `per_epoch` được, miễn phần dư do người gọi tự bỏ từ ví.
test donate_passes_when_the_caller_pays_the_excess() {
  good_donate_with([next_ok()], Some(3 * one_ada), default_window())
}

test donate_fails_without_a_donation() fail {
  good_donate_with([next_ok()], None, default_window())
}

test donate_fails_below_per_epoch() fail {
  good_donate_with(
    [fund_output(10 * one_ada - one_ada + 1, fund_datum(t_epoch))],
    Some(one_ada - 1),
    default_window(),
  )
}

test donate_fails_twice_in_the_same_epoch() fail {
  let datum = fund_datum(t_epoch)
  let input = fund_output(10 * one_ada, datum)
  run_donate(
    datum,
    input,
    donate_tx(
      input,
      [fund_output(9 * one_ada, datum)],
      Some(one_ada),
      default_window(),
      [own_redeemer(Donate)],
    ),
  )
}

test donate_fails_with_an_open_lower_bound() fail {
  good_donate_with(
    [next_ok()],
    Some(one_ada),
    interval.before(mid_epoch(t_epoch) + 600_000),
  )
}

test donate_fails_with_an_open_upper_bound() fail {
  good_donate_with(
    [next_ok()],
    Some(one_ada),
    interval.after(mid_epoch(t_epoch)),
  )
}

test donate_fails_when_the_upper_bound_reaches_the_next_epoch() fail {
  good_donate_with(
    [next_ok()],
    Some(one_ada),
    range(mid_epoch(t_epoch), t_zero + ( t_epoch + 1 ) * t_length),
  )
}

test donate_passes_with_the_upper_bound_one_ms_before_the_next_epoch() {
  good_donate_with(
    [next_ok()],
    Some(one_ada),
    range(mid_epoch(t_epoch), t_zero + ( t_epoch + 1 ) * t_length - 1),
  )
}

test donate_fails_when_the_next_datum_keeps_the_old_epoch() fail {
  good_donate_with(
    [fund_output(9 * one_ada, fund_datum(t_epoch - 1))],
    Some(one_ada),
    default_window(),
  )
}

test donate_fails_when_the_next_datum_changes_the_owner() fail {
  good_donate_with(
    [
      fund_output(
        9 * one_ada,
        EpochDonationDatum { ..fund_datum(t_epoch), owner: stranger },
      ),
    ],
    Some(one_ada),
    default_window(),
  )
}

test donate_fails_when_the_next_output_is_rehomed() fail {
  good_donate_with(
    [
      Output {
        ..next_ok(),
        address: from_script(fund_hash) |> with_delegation_key(stranger),
      },
    ],
    Some(one_ada),
    default_window(),
  )
}

/// Ô đi tiếp nằm ở địa chỉ script KHÁC: không còn output nào chạy script này ⟹ đỏ ở
/// `expect [next]`, đột biến `D_ONE_OUTPUT` đo chốt đó.
test donate_fails_when_the_fund_moves_to_another_script() fail {
  good_donate_with(
    [Output { ..next_ok(), address: from_script(other_fund_hash) }],
    Some(one_ada),
    default_window(),
  )
}

test donate_fails_when_the_caller_takes_one_lovelace_more_than_per_epoch() fail {
  good_donate_with(
    [fund_output(9 * one_ada - 1, fund_datum(t_epoch)), wallet(stranger, 1)],
    Some(one_ada),
    default_window(),
  )
}

test donate_fails_with_two_outputs_at_the_script() fail {
  good_donate_with(
    [next_ok(), Output { ..next_ok(), value: from_lovelace(2 * one_ada) }],
    Some(one_ada),
    default_window(),
  )
}

test donate_fails_when_the_nft_leaves_the_fund() fail {
  good_donate_with(
    [
      Output { ..next_ok(), value: from_lovelace(9 * one_ada) },
      Output { ..wallet(stranger, 2 * one_ada), value: fund_value(2 * one_ada) },
    ],
    Some(one_ada),
    default_window(),
  )
}

test donate_fails_when_the_next_output_carries_a_reference_script() fail {
  good_donate_with(
    [Output { ..next_ok(), reference_script: Some(other_fund_hash) }],
    Some(one_ada),
    default_window(),
  )
}

test donate_fails_with_two_redeemers() fail {
  let datum = fund_datum(t_epoch - 1)
  let input = fund_output(10 * one_ada, datum)
  let other =
    Pair(
      Spend(OutputReference { ..fund_ref(), output_index: 1 }),
      {
        let d: Data = Donate
        d
      },
    )
  run_donate(
    datum,
    input,
    donate_tx(
      input,
      [next_ok()],
      Some(one_ada),
      default_window(),
      [own_redeemer(Donate), other],
    ),
  )
}

/// Ô rác ở địa chỉ quỹ, datum đẹp, không NFT: `Donate` không đụng tới.
test donate_fails_on_a_utxo_without_the_nft() fail {
  let datum = fund_datum(t_epoch - 1)
  let input =
    Output {
      ..fund_output(10 * one_ada, datum),
      value: from_lovelace(10 * one_ada),
    }
  run_donate(
    datum,
    input,
    donate_tx(
      input,
      [Output { ..next_ok(), value: from_lovelace(9 * one_ada) }],
      Some(one_ada),
      default_window(),
      [own_redeemer(Donate)],
    ),
  )
}

// ── Reclaim ──────────────────────────────────────────────────────────────────

fn mint_redeemer() -> Pair<ScriptPurpose, Redeemer> {
  let as_data: Data = Void
  Pair(Mint(fund_hash), as_data)
}

fn reclaim_tx(
  input: Output,
  outputs: List<Output>,
  burned: Int,
  validity: Interval,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [Input { output_reference: fund_ref(), output: input }],
    outputs,
    mint: if burned == 0 {
      assets.zero
    } else {
      from_asset(fund_hash, fund_nft_name, burned)
    },
    validity_range: validity,
    redeemers,
  }
}

/// Quỹ nộp lần cuối ở epoch 100, `idle_epochs = 10` ⟹ thu hồi được từ epoch 110. Không ai ký.
fn run_reclaim_with(
  outputs: List<Output>,
  burned: Int,
  validity: Interval,
  with_nft: Bool,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
) -> Bool {
  let datum = fund_datum(t_epoch)
  let input =
    if with_nft {
      fund_output(10 * one_ada, datum)
    } else {
      Output {
        ..fund_output(10 * one_ada, datum),
        value: from_lovelace(10 * one_ada),
      }
    }
  epoch_donation.spend(
    t_seed,
    t_zero,
    t_length,
    Some(datum),
    Reclaim,
    fund_ref(),
    reclaim_tx(input, outputs, burned, validity, redeemers),
  )
}

fn run_reclaim(burned: Int, validity: Interval, with_nft: Bool) -> Bool {
  run_reclaim_with(
    [wallet(owner_key, 10 * one_ada)],
    burned,
    validity,
    with_nft,
    if with_nft {
      [own_redeemer(Reclaim), mint_redeemer()]
    } else {
      [own_redeemer(Reclaim)]
    },
  )
}

fn window_in(e: Int) -> Interval {
  range(mid_epoch(e), mid_epoch(e) + 600_000)
}

test reclaim_passes_after_idle_epochs_without_any_signature() {
  run_reclaim(-1, window_in(t_epoch + 10), True)
}

test reclaim_fails_one_epoch_early() fail {
  run_reclaim(-1, window_in(t_epoch + 9), True)
}

test reclaim_fails_when_paid_to_another_address() fail {
  run_reclaim_with(
    [wallet(stranger, 10 * one_ada)],
    -1,
    window_in(t_epoch + 10),
    True,
    [own_redeemer(Reclaim), mint_redeemer()],
  )
}

test reclaim_fails_when_the_owner_gets_one_lovelace_short() fail {
  run_reclaim_with(
    [wallet(owner_key, 10 * one_ada - 1), wallet(stranger, 1)],
    -1,
    window_in(t_epoch + 10),
    True,
    [own_redeemer(Reclaim), mint_redeemer()],
  )
}

/// Phần uỷ quyền của địa chỉ nhận không quan trọng: chỉ phần thanh toán phải là `owner`.
test reclaim_passes_to_an_owner_address_with_any_stake_key() {
  run_reclaim_with(
    [
      wallet(owner_key, 10 * one_ada)
        |> fn(o) {
            Output { ..o, address: o.address |> with_delegation_key(stranger) }
          },
    ],
    -1,
    window_in(t_epoch + 10),
    True,
    [own_redeemer(Reclaim), mint_redeemer()],
  )
}

/// Hai quỹ cùng `owner` tiêu chung một giao dịch: một output 10 ADA không được thoả cho cả hai.
test reclaim_fails_alongside_another_script_input() fail {
  run_reclaim_with(
    [wallet(owner_key, 10 * one_ada)],
    -1,
    window_in(t_epoch + 10),
    True,
    [
      own_redeemer(Reclaim),
      mint_redeemer(),
      Pair(
        Spend(OutputReference { ..fund_ref(), output_index: 1 }),
        {
          let d: Data = Reclaim
          d
        },
      ),
    ],
  )
}

test reclaim_fails_without_burning_the_nft() fail {
  run_reclaim(0, window_in(t_epoch + 10), True)
}

test reclaim_fails_with_an_open_lower_bound() fail {
  run_reclaim(-1, interval.before(mid_epoch(t_epoch + 10) + 600_000), True)
}

/// Ô rác không NFT: ai cũng trả được về `owner` (do chính người gửi đặt), bất cứ lúc nào.
test reclaim_of_a_stray_utxo_pays_its_owner() {
  run_reclaim(0, window_in(t_epoch), False)
}

test reclaim_of_a_stray_utxo_fails_when_paid_elsewhere() fail {
  run_reclaim_with(
    [wallet(stranger, 10 * one_ada)],
    0,
    window_in(t_epoch),
    False,
    [own_redeemer(Reclaim)],
  )
}

// ── Mint: mở quỹ và đốt NFT ─────────────────────────────────────────────────

fn open_output(datum: EpochDonationDatum) -> Output {
  fund_output(10 * one_ada, datum)
}

fn open_tx(spent: OutputReference, outputs: List<Output>, validity: Interval) {
  Transaction {
    ..placeholder,
    inputs: [
      Input { output_reference: spent, output: wallet(owner_key, 20 * one_ada) },
    ],
    outputs,
    mint: from_asset(fund_hash, fund_nft_name, 1),
    validity_range: validity,
  }
}

fn run_open(outputs: List<Output>, validity: Interval) -> Bool {
  let r: Data = Void
  epoch_donation.mint(
    t_seed,
    t_zero,
    t_length,
    r,
    fund_hash,
    open_tx(t_seed, outputs, validity),
  )
}

test open_passes() {
  run_open([open_output(fund_datum(t_epoch - 1))], default_window())
}

test open_fails_without_spending_the_seed() fail {
  let r: Data = Void
  epoch_donation.mint(
    t_seed,
    t_zero,
    t_length,
    r,
    fund_hash,
    open_tx(
      fund_ref(),
      [open_output(fund_datum(t_epoch - 1))],
      default_window(),
    ),
  )
}

test open_fails_when_last_epoch_is_backdated() fail {
  run_open([open_output(fund_datum(t_epoch - 2))], default_window())
}

test open_fails_when_the_window_spans_two_epochs() fail {
  run_open(
    [open_output(fund_datum(t_epoch - 1))],
    range(mid_epoch(t_epoch), t_zero + ( t_epoch + 1 ) * t_length),
  )
}

test open_fails_with_zero_per_epoch() fail {
  run_open(
    [
      open_output(
        EpochDonationDatum { ..fund_datum(t_epoch - 1), per_epoch: 0 },
      ),
    ],
    default_window(),
  )
}

test open_fails_with_zero_idle_epochs() fail {
  run_open(
    [
      open_output(
        EpochDonationDatum { ..fund_datum(t_epoch - 1), idle_epochs: 0 },
      ),
    ],
    default_window(),
  )
}

test open_fails_at_a_delegated_address() fail {
  run_open(
    [
      Output {
        ..open_output(fund_datum(t_epoch - 1)),
        address: from_script(fund_hash) |> with_delegation_key(stranger),
      },
    ],
    default_window(),
  )
}

test open_fails_with_an_extra_token() fail {
  run_open(
    [
      Output {
        ..open_output(fund_datum(t_epoch - 1)),
        value: fund_value(10 * one_ada) |> add(other_fund_hash, "junk", 1),
      },
    ],
    default_window(),
  )
}

test open_fails_with_a_reference_script() fail {
  run_open(
    [
      Output {
        ..open_output(fund_datum(t_epoch - 1)),
        reference_script: Some(other_fund_hash),
      },
    ],
    default_window(),
  )
}

/// Mốc 0 đặt SAU cận dưới: chia sàn cho epoch −1 và `last_epoch = −2` khớp — chỉ chốt
/// `lower >= epoch_zero_ms` chặn được.
test open_fails_before_epoch_zero() fail {
  let r: Data = Void
  let zero = mid_epoch(t_epoch) + 1_000_000
  epoch_donation.mint(
    t_seed,
    zero,
    t_length,
    r,
    fund_hash,
    open_tx(t_seed, [open_output(fund_datum(-2))], default_window()),
  )
}

test open_fails_with_a_non_positive_epoch_length() fail {
  let r: Data = Void
  epoch_donation.mint(
    t_seed,
    t_zero,
    -t_length,
    r,
    fund_hash,
    open_tx(
      t_seed,
      [open_output(fund_datum(( mid_epoch(t_epoch) - t_zero ) / -t_length - 1))],
      default_window(),
    ),
  )
}

test open_fails_with_a_wrong_token_name() fail {
  let r: Data = Void
  epoch_donation.mint(
    t_seed,
    t_zero,
    t_length,
    r,
    fund_hash,
    Transaction {
      ..open_tx(
        t_seed,
        [open_output(fund_datum(t_epoch - 1))],
        default_window(),
      ),
      mint: from_asset(fund_hash, "other", 1),
      outputs: [
        Output {
          ..open_output(fund_datum(t_epoch - 1)),
          value: from_lovelace(10 * one_ada) |> add(fund_hash, "other", 1),
        },
      ],
    },
  )
}

fn run_burn(mint: Value) -> Bool {
  let r: Data = Void
  epoch_donation.mint(
    t_seed,
    t_zero,
    t_length,
    r,
    fund_hash,
    Transaction { ..placeholder, mint },
  )
}

test burn_passes() {
  run_burn(from_asset(fund_hash, fund_nft_name, -1))
}

test burn_fails_for_another_name() fail {
  run_burn(from_asset(fund_hash, "other", -1))
}

test mint_fails_for_two_tokens() fail {
  run_burn(from_asset(fund_hash, fund_nft_name, 2))
}
