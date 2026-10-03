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
////
//// ─────────────────────────────────────────────────────────────────────────────
//// LỖ ĐÃ VÁ Ở BẢN NÀY — đọc trước khi sửa bất cứ dòng nào dưới đây.
////
//// Bản trước đo phần đã rời kho bằng `giữ − trả_lại`, trong đó `trả_lại` là TỔNG mọi
//// output nằm ở địa chỉ của chính mình. Bộ lọc theo ĐỊA CHỈ đó không phân biệt được
//// hai thứ hoàn toàn khác nhau:
////
////   (a) phần dư của chính ô đang tiêu — đúng là "trả lại", và
////   (b) tiền MỚI vừa được gửi vào địa chỉ này trong cùng giao dịch.
////
//// Kho phí `Skim` đổ đúng một output loại (b) vào đây. Ghép `Skim` và `Donate` vào một
//// giao dịch thì `trả_lại` phình lên bằng đúng khoản vừa trích, `released` tụt xuống
//// gần 0, và nghĩa vụ nộp kho bạc bốc hơi gần hết.
////
//// Chỗ trớ trêu: guard của kho phí ÉP va chạm này xảy ra. `escrow_receives` bên kho phí
//// đòi ĐÚNG MỘT output ở địa chỉ kho tạm, nên hình dạng giao dịch duy nhất lọt qua kho
//// phí lại đúng là hình dạng phá kho tạm.
////
//// Bản này ràng bằng DATUM chứ không bằng địa chỉ: mỗi phần dư phải tự khai nó là phần
//// dư của ô nào (`parent`). Loại (b) khai `parent = None`, nên nó không những không được
//// đếm là `trả_lại` mà còn làm cả giao dịch hỏng — `Skim` và `Donate` không còn ghép
//// chung được nữa. Hai luồng tách hẳn, và `released` không còn cách nào bị thổi phồng.
////
//// LỖ THỨ HAI, VÁ CÙNG ĐỢT: phần dư chỉ bị soi theo `payment_credential`, nên phần uỷ
//// quyền của địa chỉ là một trường tự do. Cùng băm script mà khác phần uỷ quyền là HAI
//// địa chỉ trên chuỗi. `Donate` cố ý KHÔNG đòi chữ ký ai, nên bất kỳ ai cũng tiêu ô kho
//// tạm, nộp sàn cho một mẩu CARP rồi trả phần dư về một địa chỉ dời nhà: tiền vẫn nằm
//// trong script, nhưng `utxosAt(escrowAddress)` của `05_swap_and_donate.mjs` không thấy
//// nó nữa, và phần thưởng uỷ quyền trên ADA giữ chỗ chảy về khoá của kẻ đó. Nay mỗi
//// phần dư phải đậu ĐÚNG địa chỉ của ô đang tiêu.
//// ─────────────────────────────────────────────────────────────────────────────
////
//// ĐẤU GIÁ GIẢM DẦN (bản dựng lại instance). Trả đúng sàn ở mọi thời điểm là trao cho người
//// gọi `Donate` một quyền chọn miễn phí: lấy CARP theo sàn, bỏ túi chênh lệch tới giá thị
//// trường, kho bạc chỉ nhận sàn. Nay giá mở ở TRẦN tại `listed_at` (kho phí ép mốc này
//// bằng cận trên khoảng hiệu lực của `Skim`) rồi hạ tuyến tính về sàn trong `decay_ms`.
//// Người gọi mua ở thời điểm nào thì trả giá của thời điểm đó — cạnh tranh giữa những
//// người gọi kéo giá trả về gần giá thị trường, thay vì về sàn.
////
//// Giá đọc tại cận DƯỚI khoảng hiệu lực: giá giảm theo thời gian nên cận sớm nhất cho giá
//// CAO nhất — chiều có lợi cho kho bạc — và sổ cái không cho cận dưới vượt thời điểm thật.
//// Phần dư giữ nguyên `listed_at` của ô gốc: phiên đấu giá TIẾP TỤC, không mở lại.
//// ─────────────────────────────────────────────────────────────────────────────

use aiken/collection/list
use aiken/interval.{Finite}
use cardano/address.{Address, Script, from_verification_key}
use cardano/assets.{AssetName, PolicyId, lovelace_of, quantity_of}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, ScriptPurpose, Spend,
  Transaction,
}
use orilife/fixtures.{
  carp_name, carp_policy, escrow_datum, escrow_hash, inline, input_from, now_ms,
  operator_key, ref_at, rehomed_script_output, script_output, stranger_key, tx,
  value_with_carp, vault_hash, wallet_output,
}
use orilife/math.{ceil_div}
use orilife/types.{Donate, EscrowDatum, EscrowRedeemer}

/// Một CARP = 10⁹ đơn vị nhỏ nhất (`nanothread`). Tỉ giá khai theo "lovelace cho mỗi 10⁹
/// đơn vị", tức lovelace cho mỗi 1 CARP nguyên.
const carp_scale: Int = 1_000_000_000

validator donation_escrow(
  carp_policy: PolicyId,
  carp_name: AssetName,
  /// Sàn tỉ giá: giá cuối phiên đấu giá. Mỗi 1 CARP rời kho tạm phải kéo theo ít nhất ngần
  /// này lovelace nộp kho bạc, ở BẤT KỲ thời điểm nào. Con số quản trị, không phải giá thị
  /// trường — nó chỉ chặn đáy.
  ///
  /// Đánh đổi phải nói thẳng: sàn là hằng số biên dịch, không có máng giá. Giá thị
  /// trường rơi xuống dưới sàn thì `Donate` lỗ, không ai chạy, và CARP trong kho tạm
  /// nằm lại cho tới khi có người chịu nộp đủ sàn. Đó là fail-closed NGHIÊNG VỀ kho bạc
  /// — cố ý, nhưng nó là đóng băng chứ không phải mất, và người đọc phải biết trước.
  min_lovelace_per_carp: Int,
  /// Trần tỉ giá: giá mở phiên tại `listed_at` và mọi thời điểm trước đó. Không nhỏ hơn sàn.
  start_lovelace_per_carp: Int,
  /// Thời gian (ms) giá hạ tuyến tính từ trần về sàn, tính từ `listed_at`.
  decay_ms: Int,
  /// Lượng CARP tối thiểu (đơn vị nhỏ nhất) một lần `Donate` phải nhả, trừ khi ô giữ ít
  /// hơn ngần này — khi đó phải nhả TRỌN ô. Không có câu này thì ai cũng nộp vài lovelace
  /// cho 1 đơn vị CARP, tiêu ô kho tạm liên tục và giữ chỗ nó trước người mua thật.
  /// Đặt CUỐI để thứ tự các tham số cũ không đổi.
  lot_min: Int,
) {
  spend(
    datum: Option<EscrowDatum>,
    _redeemer: EscrowRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(EscrowDatum {
      carp: declared,
      vault: own_vault,
      parent: _,
      listed_at,
    }) = datum
    expect Some(own_input) = find_input(tx.inputs, own_ref)
    expect Script(own_hash) = own_input.output.address.payment_credential

    // Chỉ cho tiêu MỘT UTxO kho tạm mỗi giao dịch. Không có câu này thì hai UTxO cùng
    // trỏ vào một khoản nộp kho bạc và một nửa số CARP rời kho không kèm đồng nào.
    let own_inputs =
      list.filter(
        tx.inputs,
        fn(input) {
          input.output.address.payment_credential == Script(own_hash)
        },
      )

    // Giá trị thật đang nằm ở đây. Không tin `declared`, chỉ dùng nó để bắt lời khai lệch.
    let held = quantity_of(own_input.output.value, carp_policy, carp_name)

    // MỌI output chạy script này — lọc theo BĂM, không theo địa chỉ đầy đủ, cố ý rộng
    // để không đầu ra nào lọt khỏi tầm soát bằng cách đổi phần uỷ quyền. Rồi bắt từng
    // cái phải tự khai mình là phần dư của ĐÚNG ô đang tiêu VÀ đậu đúng địa chỉ của ô
    // đó. Cái nào không khai được thì cả giao dịch hỏng. Đây là chỗ chặn khoản `Skim`
    // mới đi lẫn vào phép đo, và cũng là chỗ chặn phần dư dời nhà.
    let at_self =
      list.filter(
        tx.outputs,
        fn(output) { output.address.payment_credential == Script(own_hash) },
      )
    // `continuing_honest` đòi tối đa MỘT đầu ra ở đây, nên `returned` là CARP của ô dư
    // (0 khi không có ô dư) và `released = held − CARP(ô dư)`.
    let returned = sum_carp(at_self, carp_policy, carp_name)
    let released = held - returned

    // Thời điểm định giá: cận DƯỚI khoảng hiệu lực. Để ngỏ thì không có thời điểm nào.
    let priced_at =
      when tx.validity_range.lower_bound.bound_type is {
        Finite(t) -> t
        _ -> fail
      }
    // Phần thời gian còn lại của phiên, kẹp trong [0, decay_ms]: trước `listed_at` giá đứng
    // ở trần, sau `listed_at + decay_ms` giá đứng ở sàn.
    let elapsed = priced_at - listed_at
    let remaining =
      if elapsed <= 0 {
        decay_ms
      } else if elapsed >= decay_ms {
        0
      } else {
        decay_ms - elapsed
      }
    // giá/CARP = sàn + (trần − sàn) × remaining / decay_ms. Nhân hết rồi chia MỘT lần, làm
    // tròn LÊN về phía kho bạc — chia hai lần là làm tròn hai lần.
    let floor_part = min_lovelace_per_carp * decay_ms
    let premium_part =
      ( start_lovelace_per_carp - min_lovelace_per_carp ) * remaining
    let required =
      ceil_div(released * ( floor_part + premium_part ), carp_scale * decay_ms)

    and {
      // Đúng MỘT redeemer trong cả giao dịch — tức không script Plutus nào khác chạy cạnh
      // `Donate`. `treasury_donation` là trường TOÀN giao dịch: hai kho tạm khác tham số
      // (khác băm, nên câu `own_inputs` bên dưới không thấy nhau) hay bất kỳ script nào
      // khác cũng đòi `donated >= x` sẽ cùng đếm MỘT khoản nộp. Hệ quả: đổi CARP qua DEX
      // bằng script phải là giao dịch riêng.
      list.length(tx.redeemers) == 1,
      list.length(own_inputs) == 1,
      declared == held,
      released > 0,
      // Lô tối thiểu: nhả ít nhất `lot_min`, hoặc trọn ô nếu ô giữ ít hơn ngần đó.
      lot_min > 0,
      released >= min_int(held, lot_min),
      min_lovelace_per_carp > 0,
      start_lovelace_per_carp >= min_lovelace_per_carp,
      decay_ms > 0,
      donation_at_least(tx, required),
      continuing_honest(
        at_self,
        own_ref,
        own_input.output.address,
        lovelace_of(own_input.output.value),
        own_vault,
        listed_at,
        carp_policy,
        carp_name,
      ),
    }
  }

  else(_) {
    fail
  }
}

fn find_input(inputs: List<Input>, own_ref: OutputReference) -> Option<Input> {
  list.find(inputs, fn(input) { input.output_reference == own_ref })
}

fn min_int(a: Int, b: Int) -> Int {
  if a <= b {
    a
  } else {
    b
  }
}

fn sum_carp(outputs: List<Output>, policy: PolicyId, name: AssetName) -> Int {
  list.foldl(
    outputs,
    0,
    fn(output, acc) { acc + quantity_of(output.value, policy, name) },
  )
}

/// Mỗi UTxO ở băm script kho tạm trong giao dịch này phải:
///   1. đậu ĐÚNG địa chỉ của ô đang tiêu — cả phần thanh toán lẫn phần uỷ quyền. Bộ lọc
///      `at_self` cố ý chỉ so phần thanh toán để không đầu ra nào lọt khỏi tầm soát; câu
///      này mới là câu ghim nơi đến. Thiếu nó thì phần dư dời sang một địa chỉ khác cùng
///      băm: tiền không mất, nhưng `utxosAt(escrowAddress)` mất dấu và phần thưởng uỷ
///      quyền trên ADA giữ chỗ chảy về khoá của kẻ dựng giao dịch;
///   2. khai đúng số CARP nó giữ — bỏ câu này thì một lần nộp có thể để lại một UTxO
///      khai 0 trong khi giữ đầy CARP, và lần sau nó rời kho không tốn gì;
///   3. giữ nguyên băm kho phí đã trích ra khoản gốc — không cho đổi chủ giữa đường;
///   4. khai `parent` đúng bằng ô đang tiêu — đây là câu tách phần DƯ khỏi khoản MỚI;
///   5. giữ nguyên `listed_at` của ô đang tiêu — phiên đấu giá tiếp tục. Đặt lùi là hạ
///      giá cho lần mua sau; đặt tới là kéo giá về trần để đóng băng phần dư;
///   6. mang CARP > 0 — ô dư 0 CARP không bao giờ tiêu lại được (`released > 0` hỏng),
///      nên số ADA trong nó khoá vĩnh viễn;
///   7. giữ ít nhất số lovelace của ô đang tiêu — không ai rút được ADA giữ chỗ (gồm cả
///      phần thưởng của người đã trích) ra khỏi kho tạm bằng một lần `Donate`.
/// Và tối đa MỘT đầu ra như thế: chia ô thành nhiều ô dư là nhân số chỗ phải giữ ADA.
fn continuing_honest(
  outputs: List<Output>,
  own_ref: OutputReference,
  own_address: Address,
  own_lovelace: Int,
  own_vault: ByteArray,
  own_listed_at: Int,
  policy: PolicyId,
  name: AssetName,
) -> Bool {
  and {
    list.length(outputs) <= 1,
    list.all(
      outputs,
      fn(output) {
        when output.datum is {
          InlineDatum(raw) -> {
            expect EscrowDatum { carp, vault, parent, listed_at }: EscrowDatum =
              raw
            and {
              output.address == own_address,
              carp == quantity_of(output.value, policy, name),
              carp > 0,
              lovelace_of(output.value) >= own_lovelace,
              vault == own_vault,
              parent == Some(own_ref),
              listed_at == own_listed_at,
            }
          }
          _ -> False
        }
      },
    ),
  }
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
///
/// KHÔNG phải tham số deploy. Tham số thật ở `scripts/common.mjs` là
/// `MIN_LOVELACE_PER_CARP = 10_000`, gấp 20 lần con số này. Ghi ra vì bản audit đầu đã
/// lấy nhầm hằng số của bài kiểm làm giá thật và báo thiệt hại nhỏ đi 20 lần.
const test_rate: Int = 500

/// Một CARP nguyên, tính bằng đơn vị nhỏ nhất.
const carp_one: Int = 1_000_000_000

/// 1000 CARP nguyên. Bài kiểm đầu tiên viết bằng số trần (1_000) đã sai đơn vị và
/// bài kiểm bắt được: 1_000 đơn vị nhỏ nhất là một PHẦN TRIỆU của một CARP, nên sàn
/// tỉ giá làm tròn về gần 0 và mọi phép so sàn đều qua. Giữ lại ghi chú này vì đó
/// đúng là loại lỗi mà một bài kiểm "chạy là xanh" sẽ nuốt mất.
const thousand_carp: Int = 1_000 * carp_one

/// Trần dùng trong bài kiểm: gấp 10 lần sàn, cùng tỉ lệ với giá trị thử Preprod.
const test_start: Int = 5_000

/// Một phiên dài 7 ngày — bằng giá trị thử Preprod.
const test_decay: Int = 604_800_000

/// Mốc niêm yết đã qua trọn một phiên tại `now_ms` (cận dưới khoảng hiệu lực mặc định),
/// tức giá đã về sàn. Các bài đo luật SÀN dùng mốc này nên vẫn đo đúng luật như trước khi
/// có đấu giá: số lovelace chúng nộp không đổi.
const settled_listing: Int = now_ms - test_decay

fn run(declared: Int, tx_body: Transaction) -> Bool {
  run_with(
    test_rate,
    test_start,
    test_decay,
    escrow_datum(declared, None, settled_listing),
    tx_body,
  )
}

fn run_with(
  floor: Int,
  start: Int,
  decay: Int,
  d: EscrowDatum,
  tx_body: Transaction,
) -> Bool {
  run_full(floor, start, decay, test_lot_min, d, ref_at(0), tx_body)
}

/// Lô tối thiểu trong bài kiểm — bằng giá trị thử Preprod: 10 CARP nguyên.
const test_lot_min: Int = 10_000_000_000

/// Redeemer `Donate` của chính ô `own_ref` — giao dịch `Donate` thật luôn mang đúng nó.
fn own_redeemer(own_ref: OutputReference) -> Pair<ScriptPurpose, Redeemer> {
  let r: Data = Donate
  Pair(Spend(own_ref), r)
}

/// Bộ dựng `tx` để trống `redeemers`. Giao dịch thật chạy kho tạm thì có ít nhất redeemer
/// của chính ô đang tiêu, nên điền nó vào khi bài kiểm để trống. Bài nào đo chính luật
/// "đúng MỘT redeemer" thì tự điền danh sách của mình, và bộ dựng để yên.
fn run_full(
  floor: Int,
  start: Int,
  decay: Int,
  lot_min: Int,
  d: EscrowDatum,
  own_ref: OutputReference,
  tx_body: Transaction,
) -> Bool {
  let body =
    when tx_body.redeemers is {
      [] -> Transaction { ..tx_body, redeemers: [own_redeemer(own_ref)] }
      _ -> tx_body
    }
  donation_escrow.spend(
    carp_policy,
    carp_name,
    floor,
    start,
    decay,
    lot_min,
    Some(d),
    Donate,
    own_ref,
    body,
  )
}

/// UTxO kho tạm đang nằm sẵn trên chuỗi (khoản vừa trích: `parent = None`).
fn escrow_utxo(lovelace: Int, carp: Int) -> Output {
  script_output(
    escrow_hash,
    value_with_carp(lovelace, carp),
    inline(escrow_datum(carp, None, settled_listing)),
  )
}

/// Phần DƯ trả lại kho tạm, khai đúng ô nó sinh ra từ.
fn remainder_utxo(lovelace: Int, carp: Int) -> Output {
  script_output(
    escrow_hash,
    value_with_carp(lovelace, carp),
    inline(escrow_datum(carp, Some(ref_at(0)), settled_listing)),
  )
}

fn to_operator(carp: Int) -> Output {
  wallet_output(
    from_verification_key(operator_key),
    value_with_carp(2_000_000, carp),
  )
}

/// 1000 CARP × 500 = 500_000 lovelace phải vào kho bạc. Nộp đúng ngần đó thì qua.
test donate_passes_when_the_treasury_gets_the_floor() {
  run(
    thousand_carp,
    tx(
      [input_from(ref_at(0), escrow_utxo(2_000_000, thousand_carp))],
      [to_operator(thousand_carp)],
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
      [to_operator(thousand_carp)],
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
      [to_operator(thousand_carp)],
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
      [to_operator(thousand_carp)],
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
      [remainder_utxo(2_000_000, 600 * carp_one), to_operator(400 * carp_one)],
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
          inline(escrow_datum(0, Some(ref_at(0)), settled_listing)),
        ),
        to_operator(400 * carp_one),
      ],
      [],
      Some(200_000),
    ),
  )
}

/// ĐÂY LÀ BÀI KIỂM CỦA LỖ ĐÃ VÁ.
///
/// Dựng đúng giao dịch của kẻ tấn công: `Skim` 100 CARP mới đổ vào kho tạm, đồng thời
/// `Donate` tiêu ô cũ 1000 CARP và đưa hết 1000 về ví. Bản trước tính
/// `released = 1000 − 100 = 900`, tức đòi nộp cho 900 trong khi 1000 rời kho. Bản này
/// hỏng ngay vì khoản mới khai `parent = None`, không phải phần dư của ô đang tiêu.
test donate_rejects_a_fresh_skim_in_the_same_transaction() {
  !run(
    thousand_carp,
    tx(
      [input_from(ref_at(0), escrow_utxo(2_000_000, thousand_carp))],
      [
        // Khoản `Skim` mới — đúng hình dạng mà `escrow_receives` bên kho phí ép ra.
        escrow_utxo(2_000_000, 100 * carp_one),
        to_operator(thousand_carp),
      ],
      [],
      // Đủ sàn cho 900, thiếu sàn cho 1000. Bản trước cho qua đúng ở đây.
      Some(450_000),
    ),
  )
}

/// Phần dư khai `parent` của một ô KHÁC cũng hỏng. Không có câu này thì kẻ tấn công
/// chỉ cần bịa một `OutputReference` bất kỳ là lại đếm được khoản mới thành phần dư.
test partial_release_rejects_a_remainder_pointing_elsewhere() {
  !run(
    thousand_carp,
    tx(
      [input_from(ref_at(0), escrow_utxo(2_000_000, thousand_carp))],
      [
        script_output(
          escrow_hash,
          value_with_carp(2_000_000, 600 * carp_one),
          inline(escrow_datum(600 * carp_one, Some(ref_at(7)), settled_listing)),
        ),
        to_operator(400 * carp_one),
      ],
      [],
      Some(200_000),
    ),
  )
}

/// Phần dư không được đổi băm kho phí giữa đường.
test partial_release_rejects_a_remainder_that_switches_vault() {
  !run(
    thousand_carp,
    tx(
      [input_from(ref_at(0), escrow_utxo(2_000_000, thousand_carp))],
      [
        script_output(
          escrow_hash,
          value_with_carp(2_000_000, 600 * carp_one),
          inline(
            EscrowDatum {
              carp: 600 * carp_one,
              vault: escrow_hash,
              parent: Some(ref_at(0)),
              listed_at: settled_listing,
            },
          ),
        ),
        to_operator(400 * carp_one),
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
      [to_operator(thousand_carp)],
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
      [remainder_utxo(2_000_000, thousand_carp)],
      [],
      Some(500_000),
    ),
  )
}

/// Băm kho phí không dùng tới trong nhánh này, nhưng nó phải có mặt trong datum —
/// giữ một tham chiếu để người đọc thấy nó không phải trường trang trí.
test escrow_datum_carries_the_vault_hash() {
  let EscrowDatum { vault, .. } = escrow_datum(1, None, settled_listing)
  vault == vault_hash
}

// ─────────────────────────────────────────────────────────────────────────────
// ĐỊA CHỈ ĐẦY ĐỦ, KHÔNG PHẢI BĂM SCRIPT
//
// Cùng lỗ với `fee_vault.ak`, cùng đợt vá. Hai bài dưới đây là một CẶP: chúng
// khác nhau đúng một thứ — phần uỷ quyền của địa chỉ phần dư.
// ─────────────────────────────────────────────────────────────────────────────

/// Phần DƯ đậu ở một địa chỉ dời nhà: cùng băm script kho tạm, khác phần uỷ quyền.
fn rehomed_remainder_utxo(lovelace: Int, carp: Int) -> Output {
  rehomed_script_output(
    escrow_hash,
    stranger_key,
    value_with_carp(lovelace, carp),
    inline(escrow_datum(carp, Some(ref_at(0)), settled_listing)),
  )
}

/// CỰC DƯƠNG. Phần dư ở ĐÚNG địa chỉ ô đang tiêu: qua.
///
/// Giống hệt bài âm ngay dưới, khác đúng phần uỷ quyền của địa chỉ phần dư. (Trùng hình
/// dạng với `donate_allows_a_partial_release`; giữ riêng để cặp âm–dương nằm cạnh nhau
/// và không ai phải đi tìm bài dương ở chỗ khác mới đọc được phép đo.)
test partial_release_passes_when_the_remainder_stays_at_its_exact_address() {
  run(
    thousand_carp,
    tx(
      [input_from(ref_at(0), escrow_utxo(2_000_000, thousand_carp))],
      [remainder_utxo(2_000_000, 600 * carp_one), to_operator(400 * carp_one)],
      [],
      Some(200_000),
    ),
  )
}

/// CỰC ÂM — BÀI CỦA LỖ ĐÃ VÁ.
///
/// `Donate` cố ý không đòi chữ ký ai, nên "kẻ dựng giao dịch" là bất kỳ ai. Không có
/// phép so địa chỉ đầy đủ thì họ nộp sàn cho một phần nhỏ rồi trả toàn bộ phần còn lại
/// về một địa chỉ cùng băm nhưng khác phần uỷ quyền: CARP vẫn nằm trong script, nhưng
/// `utxosAt(escrowAddress)` trong `05_swap_and_donate.mjs` không thấy nó nữa — kịch bản
/// đó dừng ngay ở câu "kho tạm phải có đúng 1 UTxO" — và phần thưởng uỷ quyền trên ADA
/// giữ chỗ chảy về khoá của họ.
test partial_release_cannot_rehome_the_remainder() {
  !run(
    thousand_carp,
    tx(
      [input_from(ref_at(0), escrow_utxo(2_000_000, thousand_carp))],
      [
        rehomed_remainder_utxo(2_000_000, 600 * carp_one),
        to_operator(400 * carp_one),
      ],
      [],
      Some(200_000),
    ),
  )
}

/// Và bộ lọc `at_self` phải giữ nguyên độ RỘNG (chỉ theo băm script).
///
/// Thu hẹp nó về so-địa-chỉ-đầy-đủ thì phần dư dời nhà rơi HẲN ra khỏi phép đo: nó không
/// bị `continuing_honest` soi nữa, mà cũng không được đếm vào `returned` — nên `released`
/// phình lên và giao dịch chỉ đơn giản đòi nộp nhiều hơn. Kẻ tấn công trả đủ số đó là
/// dời được nhà. Bài này bắt đúng biến thể ấy: nộp ĐỦ SÀN cho cả 1000 CARP mà vẫn phải
/// hỏng, vì phần dư 600 không được đậu lệch địa chỉ dù có trả bao nhiêu đi nữa.
test rehomed_remainder_stays_rejected_even_when_the_floor_is_paid_in_full() {
  !run(
    thousand_carp,
    tx(
      [input_from(ref_at(0), escrow_utxo(2_000_000, thousand_carp))],
      [
        rehomed_remainder_utxo(2_000_000, 600 * carp_one),
        to_operator(400 * carp_one),
      ],
      [],
      Some(500_000),
    ),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ĐẤU GIÁ GIẢM DẦN
//
// Khuôn chung: ô kho tạm 1000 CARP niêm yết tại `now_ms`, rời hết trong một lần. Tham số
// thử: sàn 500, trần 5_000, phiên 604_800_000 ms. Giá cho 1000 CARP: trần 5_000_000,
// sàn 500_000. Mỗi cặp dương/âm khác nhau đúng MỘT lovelace.
// ─────────────────────────────────────────────────────────────────────────────

fn auction(at: Int, donated: Int) -> Bool {
  auction_with(test_rate, test_start, test_decay, at, donated)
}

fn auction_with(
  floor: Int,
  start: Int,
  decay: Int,
  at: Int,
  donated: Int,
) -> Bool {
  let listed = escrow_datum(thousand_carp, None, now_ms)
  run_with(
    floor,
    start,
    decay,
    listed,
    Transaction {
      ..tx(
        [
          input_from(
            ref_at(0),
            script_output(
              escrow_hash,
              value_with_carp(2_000_000, thousand_carp),
              inline(listed),
            ),
          ),
        ],
        [to_operator(thousand_carp)],
        [],
        Some(donated),
      ),
      validity_range: interval.after(at),
    },
  )
}

test price_equals_the_start_price_at_listed_at() {
  auction(now_ms, 5_000_000)
}

test price_at_listed_at_rejects_one_lovelace_below_the_start_price() {
  !auction(now_ms, 4_999_999)
}

/// Trước mốc niêm yết giá vẫn đứng ở trần — không vọt lên trên trần.
test price_equals_the_start_price_before_listed_at() {
  auction(now_ms - 1_000_000, 5_000_000)
}

test price_before_listed_at_rejects_one_lovelace_below_the_start_price() {
  !auction(now_ms - 1_000_000, 4_999_999)
}

test price_equals_the_floor_at_listed_at_plus_decay() {
  auction(now_ms + test_decay, 500_000)
}

test price_at_listed_at_plus_decay_rejects_one_lovelace_below_the_floor() {
  !auction(now_ms + test_decay, 499_999)
}

/// Sau phiên giá đứng ở sàn — không rơi xuống dưới sàn.
test price_equals_the_floor_after_the_auction_ends() {
  auction(now_ms + 2 * test_decay, 500_000)
}

test price_after_the_auction_rejects_one_lovelace_below_the_floor() {
  !auction(now_ms + 2 * test_decay, 499_999)
}

/// Giữa phiên. remaining = 302_400_000 = decay/2.
///   required = ⌈10¹² × (500 × 604_800_000 + 4_500 × 302_400_000) / (10⁹ × 604_800_000)⌉
///            = ⌈10¹² × 1_663_200_000_000 / 604_800_000_000_000_000⌉
///            = ⌈1_663_200_000_000_000_000_000_000 / 604_800_000_000_000_000⌉ = 2_750_000
/// (chia hết: 2_750 lovelace mỗi CARP = sàn 500 + nửa khoảng 4_500).
test price_at_mid_auction_is_exact() {
  auction(now_ms + test_decay / 2, 2_750_000)
}

test price_at_mid_auction_rejects_one_lovelace_below() {
  !auction(now_ms + test_decay / 2, 2_749_999)
}

// ─── Chiều làm tròn: LÊN, về phía kho bạc ───────────────────────────────────
// Ba điểm giá KHÔNG chia hết. Mỗi bài dương nộp đúng ceil, bài âm nộp ceil − 1 (= floor):
// đổi `ceil_div` thành chia nguyên thường thì bài âm qua.

fn auction_of(held: Int, at: Int, donated: Int) -> Bool {
  let listed = escrow_datum(held, None, now_ms)
  run_with(
    test_rate,
    test_start,
    test_decay,
    listed,
    Transaction {
      ..tx(
        [
          input_from(
            ref_at(0),
            script_output(
              escrow_hash,
              value_with_carp(2_000_000, held),
              inline(listed),
            ),
          ),
        ],
        [to_operator(held)],
        [],
        Some(donated),
      ),
      validity_range: interval.after(at),
    },
  )
}

/// Giữa phiên, `released` = 1000 CARP + 1 đơn vị = 1_000_000_000_001 (lẻ).
///   giá/CARP = (500 × 604_800_000 + 4_500 × 302_400_000) / 604_800_000 = 2_750 (nguyên)
///   required = ⌈1_000_000_000_001 × 2_750 / 10⁹⌉ = ⌈2_750_000_000_002_750 / 10⁹⌉
///            = ⌈2_750_000,00000275⌉ = 2_750_001   (chia thường cho 2_750_000)
test mid_auction_rounds_up_for_an_odd_release() {
  auction_of(thousand_carp + 1, now_ms + test_decay / 2, 2_750_001)
}

test mid_auction_rejects_the_rounded_down_amount() {
  !auction_of(thousand_carp + 1, now_ms + test_decay / 2, 2_750_000)
}

/// 1 ms sau niêm yết, 1000 CARP: remaining = 604_799_999, giá/CARP không nguyên.
///   required = ⌈10¹² × (500 × 604_800_000 + 4_500 × 604_799_999) / (10⁹ × 604_800_000)⌉
///            = ⌈1_000 × (3_024_000_000_000 − 4_500) / 604_800_000⌉
///            = ⌈(3_024_000_000_000_000 − 4_500_000) / 604_800_000⌉
///            = ⌈5_000_000 − 0,00744…⌉ = 5_000_000   (chia thường cho 4_999_999)
test one_ms_after_listing_rounds_up() {
  auction_of(thousand_carp, now_ms + 1, 5_000_000)
}

test one_ms_after_listing_rejects_the_rounded_down_amount() {
  !auction_of(thousand_carp, now_ms + 1, 4_999_999)
}

/// Ở sàn (sau phiên), `released` = 3 CARP + 1 đơn vị = 3_000_000_001 (lẻ).
///   required = ⌈3_000_000_001 × 500 / 10⁹⌉ = ⌈1_500_000_000_500 / 10⁹⌉ = ⌈1_500,0000005⌉
///            = 1_501   (chia thường cho 1_500)
test floor_price_rounds_up_for_an_odd_release() {
  auction_of(3 * carp_one + 1, now_ms + 2 * test_decay, 1_501)
}

test floor_price_rejects_the_rounded_down_amount() {
  !auction_of(3 * carp_one + 1, now_ms + 2 * test_decay, 1_500)
}

/// Cận dưới để ngỏ: không có thời điểm định giá. Nộp gấp 10 lần trần vẫn hỏng. (Bài `fail`
/// vì validator dừng bằng `fail` ở chỗ đọc cận dưới, không trả `False`.)
test donate_rejects_an_unbounded_lower_validity_bound() fail {
  let listed = escrow_datum(thousand_carp, None, now_ms)
  run_with(
    test_rate,
    test_start,
    test_decay,
    listed,
    Transaction {
      ..tx(
        [
          input_from(
            ref_at(0),
            script_output(
              escrow_hash,
              value_with_carp(2_000_000, thousand_carp),
              inline(listed),
            ),
          ),
        ],
        [to_operator(thousand_carp)],
        [],
        Some(50_000_000),
      ),
      validity_range: interval.before(now_ms + 1_000),
    },
  )
}

/// Trần dưới sàn là tham số hỏng. Nộp đúng "giá trần" 499 × 1000 thì phải hỏng.
test donate_rejects_a_start_price_below_the_floor() {
  !auction_with(500, 499, test_decay, now_ms, 499_000)
}

/// Phiên dài không dương là tham số hỏng. Nộp gấp 10 lần trần vẫn phải hỏng.
test donate_rejects_a_non_positive_decay() {
  !auction_with(test_rate, test_start, -test_decay, now_ms, 50_000_000)
}

/// Phần dư khai một mốc niêm yết khác ô gốc. Cùng khuôn với bài dương
/// `partial_release_passes_when_the_remainder_stays_at_its_exact_address`.
fn remainder_listed_at(listed_at: Int) -> Bool {
  run(
    thousand_carp,
    tx(
      [input_from(ref_at(0), escrow_utxo(2_000_000, thousand_carp))],
      [
        script_output(
          escrow_hash,
          value_with_carp(2_000_000, 600 * carp_one),
          inline(
            EscrowDatum {
              carp: 600 * carp_one,
              vault: vault_hash,
              parent: Some(ref_at(0)),
              listed_at,
            },
          ),
        ),
        to_operator(400 * carp_one),
      ],
      [],
      Some(200_000),
    ),
  )
}

/// CỰC DƯƠNG của cặp dưới: giữ nguyên mốc thì qua.
test remainder_keeps_listed_at() {
  remainder_listed_at(settled_listing)
}

/// Lùi mốc: lần mua sau rẻ hơn mức phiên cho phép.
test remainder_cannot_move_listed_at_earlier() {
  !remainder_listed_at(settled_listing - 1)
}

/// Đẩy mốc tới: kéo giá phần dư về trần để đóng băng nó.
test remainder_cannot_move_listed_at_later() {
  !remainder_listed_at(settled_listing + 1)
}

// ─────────────────────────────────────────────────────────────────────────────
// ĐỢT SỬA R11. Mỗi hàng rào một cặp: bài dương cùng khuôn, bài âm đổi đúng một thứ.
// ─────────────────────────────────────────────────────────────────────────────

/// Băm của một instance kho tạm THỨ HAI (khác tham số ⟹ khác băm).
const escrow2_hash: ByteArray =
  #"99999999999999999999999999999999999999999999999999999999"

/// Hai ô kho tạm, một ở `escrow_hash` (ref 0), một ở `second` (ref 1), mỗi ô 1000 CARP,
/// cả hai đã về sàn 500/CARP ⟹ mỗi ô một mình đòi nộp 500_000. Giao dịch mang redeemer
/// của CẢ HAI ô — đúng như sổ cái đòi khi tiêu hai ô script.
fn two_escrow_tx(donated: Int, second: ByteArray) -> Transaction {
  let d = escrow_datum(thousand_carp, None, settled_listing)
  Transaction {
    ..tx(
      [
        input_from(
          ref_at(0),
          script_output(
            escrow_hash,
            value_with_carp(2_000_000, thousand_carp),
            inline(d),
          ),
        ),
        input_from(
          ref_at(1),
          script_output(
            second,
            value_with_carp(2_000_000, thousand_carp),
            inline(d),
          ),
        ),
      ],
      [to_operator(2 * thousand_carp)],
      [],
      Some(donated),
    ),
    redeemers: [own_redeemer(ref_at(0)), own_redeemer(ref_at(1))],
  }
}

fn spend_as(own_ref: OutputReference, b: Transaction) -> Bool {
  run_full(
    test_rate,
    test_start,
    test_decay,
    test_lot_min,
    escrow_datum(thousand_carp, None, settled_listing),
    own_ref,
    b,
  )
}

/// CỰC ÂM — PoC của lỗ "hai kho tạm dùng chung một khoản nộp". 2000 CARP rời hai kho,
/// đúng ra phải nộp 1_000_000; một khoản 500_000 từng thoả CẢ HAI ô. Nay cả hai ô hỏng.
test r11a_two_escrow_instances_cannot_share_one_treasury_donation() {
  let b = two_escrow_tx(500_000, escrow2_hash)
  and {
    !spend_as(ref_at(0), b),
    !spend_as(ref_at(1), b),
  }
}

/// Nộp đủ cho cả hai vẫn hỏng: luật là "không script nào khác chạy cạnh", không phải
/// "nộp đủ tổng". Hai kho tạm phải đi hai giao dịch.
test r11a_two_escrow_instances_rejected_even_when_both_are_paid() {
  !spend_as(ref_at(0), two_escrow_tx(1_000_000, escrow2_hash))
}

/// Một script lạ bất kỳ (redeemer thứ hai, không tiêu ô nào ở kho tạm) đi cạnh `Donate`.
/// Giao dịch còn lại giống hệt bài dương `donate_passes_when_the_treasury_gets_the_floor`.
test r11a_donate_rejects_any_other_script_in_the_transaction() {
  let other: Data = Void
  !run(
    thousand_carp,
    Transaction {
      ..tx(
        [input_from(ref_at(0), escrow_utxo(2_000_000, thousand_carp))],
        [to_operator(thousand_carp)],
        [],
        Some(500_000),
      ),
      redeemers: [own_redeemer(ref_at(0)), Pair(Spend(ref_at(7)), other)],
    },
  )
}

/// CỰC DƯƠNG của cặp trên: chỉ redeemer của chính ô, ghi tường minh.
test r11a_donate_passes_with_exactly_its_own_redeemer() {
  run(
    thousand_carp,
    Transaction {
      ..tx(
        [input_from(ref_at(0), escrow_utxo(2_000_000, thousand_carp))],
        [to_operator(thousand_carp)],
        [],
        Some(500_000),
      ),
      redeemers: [own_redeemer(ref_at(0))],
    },
  )
}

/// Khuôn nhả một phần: ô 1000 CARP / 2 ADA, ô dư theo tham số, phần còn lại ra ví.
/// Nộp 500_000 — đủ sàn cho TRỌN 1000 CARP, nên không bài nào dưới đây hỏng vì sàn.
fn partial(remainders: List<Output>, released: Int) -> Bool {
  run(
    thousand_carp,
    tx(
      [input_from(ref_at(0), escrow_utxo(2_000_000, thousand_carp))],
      list.concat(remainders, [to_operator(released)]),
      [],
      Some(500_000),
    ),
  )
}

/// CỰC DƯƠNG: một ô dư, cùng lovelace với ô vào.
test r11b_one_remainder_with_equal_lovelace_passes() {
  partial([remainder_utxo(2_000_000, 600 * carp_one)], 400 * carp_one)
}

/// Ô dư nhiều lovelace hơn ô vào: qua (chỉ cấm GIẢM).
test r11b_remainder_with_more_lovelace_passes() {
  partial([remainder_utxo(2_000_001, 600 * carp_one)], 400 * carp_one)
}

/// Ô dư ít hơn ô vào 1 lovelace: bác. Đây là đường bắn tỉa ADA giữ chỗ.
test r11b_remainder_with_less_lovelace_is_rejected() {
  !partial([remainder_utxo(1_999_999, 600 * carp_one)], 400 * carp_one)
}

/// Hai ô dư, mỗi ô khai đúng, đúng địa chỉ, đủ lovelace: bác vì là HAI ô.
test r11b_two_remainders_are_rejected() {
  !partial(
    [
      remainder_utxo(2_000_000, 300 * carp_one),
      remainder_utxo(2_000_000, 300 * carp_one),
    ],
    400 * carp_one,
  )
}

/// Ô dư 0 CARP (nhả trọn 1000 CARP nhưng để lại một ô chỉ-ADA ở kho tạm): bác. Ô đó
/// không bao giờ tiêu lại được vì `released > 0` hỏng.
test r11b_remainder_with_zero_carp_is_rejected() {
  !partial([remainder_utxo(2_000_000, 0)], thousand_carp)
}

/// CỰC DƯƠNG của bài trên: nhả trọn, không ô dư.
test r11b_full_release_without_remainder_passes() {
  partial([], thousand_carp)
}

/// Khuôn lô tối thiểu: ô giữ `held`, nhả `released`, phần còn lại thành ô dư. Nộp dư dả
/// (10 ADA) để chỉ luật lô quyết định kết quả.
fn lot(held: Int, released: Int) -> Bool {
  let rest = held - released
  let remainders =
    if rest > 0 {
      [remainder_utxo(2_000_000, rest)]
    } else {
      []
    }
  run(
    held,
    tx(
      [input_from(ref_at(0), escrow_utxo(2_000_000, held))],
      list.concat(remainders, [to_operator(released)]),
      [],
      Some(10_000_000),
    ),
  )
}

/// Ô 1000 CARP, nhả 1 đơn vị nhỏ nhất: bác.
test r11c_donate_one_unit_when_held_exceeds_lot_min_is_rejected() {
  !lot(thousand_carp, 1)
}

/// Biên: nhả đúng `lot_min` thì qua, thiếu 1 đơn vị thì bác.
test r11c_release_of_exactly_lot_min_passes() {
  lot(thousand_carp, test_lot_min)
}

test r11c_release_one_unit_below_lot_min_is_rejected() {
  !lot(thousand_carp, test_lot_min - 1)
}

/// Ô nhỏ hơn `lot_min` (5 CARP): nhả trọn thì qua — ô vụn không bị kẹt.
test r11c_full_release_below_lot_min_passes() {
  lot(5 * carp_one, 5 * carp_one)
}

/// Ô nhỏ hơn `lot_min`: nhả một phần thì bác — phải nhả trọn.
test r11c_partial_release_below_lot_min_is_rejected() {
  !lot(5 * carp_one, 4 * carp_one)
}

/// Tham số `lot_min` không dương là tham số hỏng (luật lô thành vô nghĩa). Giao dịch giống
/// hệt bài dương `r11c_release_of_exactly_lot_min_passes` trừ tham số.
test r11c_non_positive_lot_min_is_rejected() {
  !run_full(
    test_rate,
    test_start,
    test_decay,
    0,
    escrow_datum(thousand_carp, None, settled_listing),
    ref_at(0),
    tx(
      [input_from(ref_at(0), escrow_utxo(2_000_000, thousand_carp))],
      [remainder_utxo(2_000_000, thousand_carp - 1), to_operator(1)],
      [],
      Some(10_000_000),
    ),
  )
}
