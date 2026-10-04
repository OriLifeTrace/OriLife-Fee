//// Hộp thư phí. Địa chỉ trung gian cho CARP phí nền tảng, dành cho những giao dịch không
//// kèm được `Collect` của kho phí (ví dụ giao dịch ConsumeMAGIC chỉ có thể trả CARP tới
//// một địa chỉ). Tiền ở đây chỉ có MỘT lối ra có nghĩa: vào sổ kho phí.
////
//// Ai cũng gom được, cố ý: không phụ thuộc OriLife. Lovelace và token khác nằm trong UTxO
//// hộp thư KHÔNG datum KHÔNG bị ràng — đó là phần thưởng cho người gom (min-ADA do bên trả
//// phí nộp), tức động cơ để bất kỳ ai chạy việc gom.
////
//// HOÀN MIN-ADA (v2). Nông dân trả phí không có ADA, nên bên ứng phí (Feecover) nộp hộ
//// min-ADA của ô hộp thư. Ô mang `InlineDatum` dạng `InboxDatum { refund }` (`types.ak`)
//// là ô "có hoàn": khi gom, lovelace của ô trừ `refund_fee` phải về payment credential
//// `refund`; người gom chỉ giữ `refund_fee` mỗi ô. Ô không datum giữ đúng hành vi cũ.
////
//// Datum sai hình (không giải mã được thành `InboxDatum`, hoặc là `DatumHash`) ⟹ coi như ô
//// không datum, KHÔNG làm kẹt tiền. Lý do: Feecover tự soát datum trong chính giao dịch nó
//// ký, nên datum sai hình là lỗi của bên ứng; còn nếu từ chối ô đó thì CARP trong ô kẹt
//// vĩnh viễn ở hộp thư (không lối ra nào khác) — kẹt tiền phí tệ hơn mất khoản ứng.
////
//// Phép so hoàn GỘP THEO CREDENTIAL: với mỗi credential `c`, tổng lovelace mọi đầu ra có
//// payment credential `c` ≥ Σ (lovelace(ô) − `refund_fee`) trên mọi ô có hoàn mang `c`.
//// So từng ô với "có một đầu ra đủ" thì một đầu ra thoả cho hai ô cùng `c` (thoả kép, cùng
//// họ với phép so CARP gộp ở dưới).
////
//// Chỗ hở biết trước, nằm ngoài hộp thư: đầu ra hoàn không mang dấu gì của ô nó hoàn, nên
//// nếu CÙNG giao dịch còn một script khác cũng đòi "trả đủ cho `c`" thì một đầu ra có thể
//// thoả cả hai. Hộp thư không thấy luật của script khác; bên dùng `c` làm đích ở nơi khác
//// phải tự chặn ghép giao dịch.
////
//// Hộp thư không đọc redeemer của kho phí. Nó không cần: trong mọi nhánh của kho, chỉ
//// `Collect` làm CARP ở ô sổ TĂNG (`Operate` cấm nạp, `Skim` làm giảm), và `Collect` ép
//// `collected` tăng đúng bằng phần tăng. Nên "CARP ô sổ tăng ít nhất bằng X" đã có nghĩa
//// là "X đã vào sổ".
////
//// Vì sao phép so cộng CẢ CARP của đầu vào lạc bên kho: kho tự kiểm phần tăng ≥ CARP lạc
//// của nó, hộp thư tự kiểm phần tăng ≥ CARP hộp thư. Mỗi bên kiểm riêng thì hộp thư 100 +
//// lạc 100 mà kho chỉ tăng 100 vẫn qua cả hai — một phần tăng thoả cho hai nguồn. Phép so
//// GỘP ở đây là chỗ duy nhất nhìn thấy cả hai nguồn cùng lúc.
////
//// VÌ SAO HAI MẶT (withdraw-zero). Nếu mỗi ô hộp thư tự chạy toàn bộ phép kiểm gom thì
//// mỗi lượt phải duyệt MỌI đầu vào, và một lần gom N ô tốn N × O(N): đo được 20 ô đã vượt
//// trần 14M mem của một giao dịch. Nay phép kiểm gom chạy ĐÚNG MỘT LẦN ở mặt `withdraw`
//// (rút 0 lovelace từ stake credential của chính script này), còn mỗi ô hộp thư chỉ kiểm
//// rằng lượt `withdraw` đó có mặt. Ledger chỉ cho rút từ một credential script khi script
//// đó chạy và trả đúng, nên "có withdrawal của chính mình" nghĩa là "phép kiểm gom đã qua".
//// Đòi hỏi vận hành: stake credential của script phải được ĐĂNG KÝ một lần trên chuỗi.
////
//// Hệ quả phải biết: UTxO nào đặt ở địa chỉ hộp thư cũng là của chùa — kể cả một ô giữ
//// reference script. Đừng đặt gì ở đây ngoài CARP phí.

use aiken/collection/list
use aiken/collection/pairs
use aiken/primitive/bytearray
use cardano/address.{
  Address, Credential, Script, VerificationKey, from_verification_key,
}
use cardano/assets.{
  AssetName, PolicyId, from_lovelace, lovelace_of, quantity_of,
}
use cardano/certificate.{
  Certificate, DelegateBlockProduction, DelegateCredential, RegisterCredential,
  UnregisterCredential,
}
use cardano/transaction.{
  DatumHash, InlineDatum, Input, NoDatum, Output, OutputReference, Transaction,
}
use orilife/fixtures.{
  carp_name, carp_policy, inbox_hash, inline, input_from, operator_key, ref_at,
  script_output, stranger_key, tx, value_with_carp, vault_hash, wallet_output,
  with_vault_nft,
}
use orilife/types.{InboxDatum, VaultDatum, vault_nft_name}

/// τ — lovelace người gom được giữ trên MỖI ô có hoàn; phần còn lại của ô về `refund`.
/// Hằng biên dịch: đổi nó là đổi băm hộp thư (tức đổi địa chỉ). Trần 200_000 được ghim
/// bằng bài `refund_fee_stays_within_its_cap`.
const refund_fee: Int = 100_000

validator fee_inbox(
  carp_policy: PolicyId,
  carp_name: AssetName,
  /// Băm kho phí. Đồng thời là policy của NFT sổ — kho phí đúc NFT bằng chính script mình.
  vault_hash: ByteArray,
) {
  /// Mỗi ô hộp thư: chỉ đòi lượt rút từ stake credential của CHÍNH script này có mặt trong
  /// giao dịch. Credential của script khác không thay được — script khác không chạy phép
  /// kiểm gom của hộp thư này.
  spend(
    _datum: Option<Data>,
    _redeemer: Data,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(own_input) =
      list.find(tx.inputs, fn(input) { input.output_reference == own_ref })
    expect Script(own_hash) = own_input.output.address.payment_credential
    pairs.has_key(tx.withdrawals, Script(own_hash))
  }

  /// Phép kiểm gom, một lần cho cả giao dịch.
  withdraw(_redeemer: Data, account: Credential, tx: Transaction) {
    // Thứ tự phép so là thứ tự theo chi phí: so credential (một phép so byte) trước, chỉ
    // đọc giá trị khi credential đã khớp.
    let inbox_credential = account
    let vault_credential = Script(vault_hash)
    // Một vòng qua đầu vào, chia ba loại: ô hộp thư (MỌI ô ở script này), ô sổ (giữ NFT),
    // ô lạc bên kho (script kho, không NFT).
    // Ô hộp thư có hoàn còn cộng nợ hoàn vào `owed`, gộp theo credential.
    let (ledger_inputs, inbox_carp, vault_stray_carp, owed) =
      list.foldr(
        tx.inputs,
        ([], 0, 0, []),
        fn(input, acc) {
          let (ledgers, inbox, strays, owed) = acc
          let output = input.output
          let credential = output.address.payment_credential
          if credential == inbox_credential {
            (
              ledgers,
              inbox + carp_of(output, carp_policy, carp_name),
              strays,
              add_refund_owed(owed, output),
            )
          } else if holds_vault_nft(output, vault_hash) {
            ([output, ..ledgers], inbox, strays, owed)
          } else if credential == vault_credential {
            (
              ledgers,
              inbox,
              strays + carp_of(output, carp_policy, carp_name),
              owed,
            )
          } else {
            acc
          }
        },
      )

    let ledger_outputs =
      list.filter(
        tx.outputs,
        fn(output) { holds_vault_nft(output, vault_hash) },
      )
    when (ledger_inputs, ledger_outputs) is {
      ([ledger_input], [ledger_output]) -> {
        let ledger_gain =
          carp_of(ledger_output, carp_policy, carp_name) - carp_of(
            ledger_input,
            carp_policy,
            carp_name,
          )
        and {
          ledger_gain >= inbox_carp + vault_stray_carp,
          refunds_paid(owed, tx.outputs),
        }
      }
      _ -> False
    }
  }

  /// Chỉ cho ĐĂNG KÝ stake credential (cần một lần để withdraw-zero chạy được). Ledger chỉ
  /// gọi script này cho chứng chỉ của chính credential của nó, nên không cần so băm.
  ///   * huỷ đăng ký: người huỷ nhận lại tiền cọc mà người khác đã nộp, và sau đó mọi lần
  ///     gom hỏng cho tới khi có ai đăng ký lại — cấm;
  ///   * uỷ quyền (pool, DRep, hay cả hai, kể cả gộp với đăng ký): địa chỉ hộp thư là
  ///     enterprise nên không có gì để uỷ quyền; mở ra chỉ là thêm bề mặt — cấm.
  publish(_redeemer: Data, certificate: Certificate, _tx: Transaction) {
    when certificate is {
      RegisterCredential { .. } -> True
      _ -> False
    }
  }

  else(_) {
    fail
  }
}

fn holds_vault_nft(output: Output, vault_hash: ByteArray) -> Bool {
  quantity_of(output.value, vault_hash, vault_nft_name) == 1
}

fn carp_of(output: Output, policy: PolicyId, name: AssetName) -> Int {
  quantity_of(output.value, policy, name)
}

/// Cộng nợ hoàn của một ô hộp thư vào bảng `owed` (gộp theo credential). Ô không có datum
/// `InboxDatum` hợp lệ thì không nợ gì — lovelace của nó là phần thưởng người gom.
fn add_refund_owed(
  owed: Pairs<Credential, Int>,
  output: Output,
) -> Pairs<Credential, Int> {
  when output.datum is {
    InlineDatum(data) ->
      if data is InboxDatum { refund }: InboxDatum {
        // Băm không đủ 28 byte thì không địa chỉ nào trên chuỗi mang được credential đó:
        // đòi hoàn về nó là khoá vĩnh viễn ô (và CARP trong ô). Coi là datum sai hình.
        if bytearray.length(credential_hash(refund)) == 28 {
          add_to_credential(
            owed,
            refund,
            lovelace_of(output.value) - refund_fee,
          )
        } else {
          owed
        }
      } else {
        owed
      }
    _ -> owed
  }
}

fn credential_hash(credential: Credential) -> ByteArray {
  when credential is {
    VerificationKey(hash) -> hash
    Script(hash) -> hash
  }
}

/// Cộng `amount` vào dòng của `credential`; chưa có dòng thì thêm dòng mới. Bảng nhỏ (số
/// credential khác nhau trong một lần gom), nên duyệt tuyến tính rẻ hơn mọi cấu trúc khác.
fn add_to_credential(
  owed: Pairs<Credential, Int>,
  credential: Credential,
  amount: Int,
) -> Pairs<Credential, Int> {
  when owed is {
    [] -> [Pair(credential, amount)]
    [Pair(known, total), ..rest] ->
      if known == credential {
        [Pair(known, total + amount), ..rest]
      } else {
        [Pair(known, total), ..add_to_credential(rest, credential, amount)]
      }
  }
}

/// Mỗi credential trong bảng nợ nhận đủ: tổng lovelace mọi đầu ra có payment credential đó
/// ≥ tổng nợ. Chỉ so payment credential — phần uỷ quyền và datum của đầu ra tự do.
///
/// Không có ô có hoàn ⟹ không đọc đầu ra nào (giữ chi phí lần gom kiểu cũ). Có thì rút
/// (credential, lovelace) của mọi đầu ra MỘT lần, rồi mỗi dòng nợ quét danh sách đã rút:
/// trích trường địa chỉ của đầu ra là phần đắt, đừng lặp nó theo số dòng nợ.
fn refunds_paid(owed: Pairs<Credential, Int>, outputs: List<Output>) -> Bool {
  when owed is {
    [] -> True
    _ -> {
      let paid: Pairs<Credential, Int> =
        list.map(
          outputs,
          fn(output) {
            Pair(output.address.payment_credential, lovelace_of(output.value))
          },
        )
      list.all(
        owed,
        fn(entry) {
          let Pair(credential, total) = entry
          lovelace_paid_to(paid, credential) >= total
        },
      )
    }
  }
}

fn lovelace_paid_to(paid: Pairs<Credential, Int>, credential: Credential) -> Int {
  list.foldl(
    paid,
    0,
    fn(entry, sum) {
      let Pair(payee, lovelace) = entry
      if payee == credential {
        sum + lovelace
      } else {
        sum
      }
    },
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Bài kiểm. Hộp thư không chạy được luật của kho; bài bên kho cho cùng hình dạng giao
// dịch là `collect_accepts_inbox_inputs_alongside_the_ledger` trong `fee_vault.ak`.
// ─────────────────────────────────────────────────────────────────────────────

fn void() -> Data {
  let v: Data = Void
  v
}

/// Mặt `withdraw` — luật gom.
fn withdraw_ok(tx_body: Transaction) -> Bool {
  fee_inbox.withdraw(
    carp_policy,
    carp_name,
    vault_hash,
    void(),
    Script(inbox_hash),
    tx_body,
  )
}

/// Mặt `spend` của một ô hộp thư.
fn spend_ok(own_ref: OutputReference, tx_body: Transaction) -> Bool {
  fee_inbox.spend(
    carp_policy,
    carp_name,
    vault_hash,
    None,
    void(),
    own_ref,
    tx_body,
  )
}

fn publish_ok(certificate: Certificate) -> Bool {
  fee_inbox.publish(
    carp_policy,
    carp_name,
    vault_hash,
    void(),
    certificate,
    tx([], [], [], None),
  )
}

fn ledger(carp: Int) -> Output {
  script_output(
    vault_hash,
    with_vault_nft(value_with_carp(2_000_000, carp)),
    inline(VaultDatum { collected: carp, skimmed: 0, operator_key }),
  )
}

/// UTxO hộp thư như bên trả phí để lại: không datum.
fn inbox_utxo(lovelace: Int, carp: Int) -> Output {
  script_output(inbox_hash, value_with_carp(lovelace, carp), NoDatum)
}

/// UTxO lạc ở địa chỉ kho: không NFT, không datum.
fn vault_stray(carp: Int) -> Output {
  script_output(vault_hash, value_with_carp(3_000_000, carp), NoDatum)
}

/// Giao dịch gom: đầu vào đánh số theo vị trí, kèm lượt rút 0 từ chính hộp thư.
fn sweep(inputs: List<Output>, outputs: List<Output>) -> Transaction {
  Transaction {
    ..tx(
      list.indexed_map(inputs, fn(i, output) { input_from(ref_at(i), output) }),
      outputs,
      [],
      None,
    ),
    withdrawals: [Pair(Script(inbox_hash), 0)],
  }
}

/// CỰC DƯƠNG. Ô hộp thư không datum, 100 CARP; ô sổ tăng đúng 100. Cả hai mặt đều qua.
test an_inbox_utxo_without_datum_is_sweepable_into_collect() {
  let body = sweep([ledger(0), inbox_utxo(2_000_000, 100)], [ledger(100)])
  and {
    withdraw_ok(body),
    spend_ok(ref_at(1), body),
  }
}

test sweep_fails_when_the_vault_gains_less_than_the_inbox_carp() {
  !withdraw_ok(sweep([ledger(0), inbox_utxo(2_000_000, 100)], [ledger(99)]))
}

/// Ô "sổ" ở địa chỉ kho nhưng không giữ NFT: không phải sổ.
test sweep_fails_without_the_vault_nft_input() {
  !withdraw_ok(
    sweep(
      [
        script_output(
          vault_hash,
          value_with_carp(2_000_000, 0),
          inline(VaultDatum { collected: 0, skimmed: 0, operator_key }),
        ),
        inbox_utxo(2_000_000, 100),
      ],
      [ledger(100)],
    ),
  )
}

test sweep_fails_without_the_vault_nft_output() {
  !withdraw_ok(
    sweep(
      [ledger(0), inbox_utxo(2_000_000, 100)],
      [
        script_output(
          vault_hash,
          value_with_carp(2_000_000, 100),
          inline(VaultDatum { collected: 100, skimmed: 0, operator_key }),
        ),
        wallet_output(
          from_verification_key(stranger_key),
          with_vault_nft(from_lovelace(2_000_000)),
        ),
      ],
    ),
  )
}

/// CỰC DƯƠNG của cặp dưới: hộp thư 100 + lạc 100, sổ tăng 200.
test inbox_and_vault_stray_carp_both_reach_the_ledger() {
  withdraw_ok(
    sweep(
      [ledger(0), inbox_utxo(2_000_000, 100), vault_stray(100)],
      [ledger(200)],
    ),
  )
}

/// Hộp thư 100 + lạc 100 mà sổ chỉ tăng 100. Kho tự kiểm (tăng ≥ lạc) và hộp thư kiểm
/// riêng phần mình (tăng ≥ hộp thư) thì cả hai đều qua; chỉ phép so gộp chặn được.
test combined_inbox_and_vault_stray_cannot_share_one_ledger_gain() {
  !withdraw_ok(
    sweep(
      [ledger(0), inbox_utxo(2_000_000, 100), vault_stray(100)],
      [ledger(100)],
    ),
  )
}

/// Hai ô hộp thư 100 mỗi ô, sổ tăng 100: phép kiểm gom cộng MỌI ô ở script này.
test two_inbox_inputs_cannot_share_one_ledger_gain() {
  !withdraw_ok(
    sweep(
      [ledger(0), inbox_utxo(2_000_000, 100), inbox_utxo(2_000_000, 100)],
      [ledger(100)],
    ),
  )
}

/// Lovelace của ô hộp thư về người gom: không ràng buộc.
test inbox_lovelace_may_go_to_the_sweeper() {
  withdraw_ok(
    sweep(
      [ledger(0), inbox_utxo(5_000_000, 100)],
      [
        ledger(100),
        wallet_output(
          from_verification_key(stranger_key),
          from_lovelace(5_000_000),
        ),
      ],
    ),
  )
}

/// Hai đầu vào giữ NFT (phòng thủ — tổng cung 1). Ô sổ ĐẦU TIÊN cho phần tăng đủ, nên bài
/// chỉ đỏ vì đòi đúng một ô sổ vào.
test sweep_rejects_two_ledger_inputs() {
  !withdraw_ok(
    sweep([ledger(0), ledger(0), inbox_utxo(2_000_000, 100)], [ledger(100)]),
  )
}

/// Hai đầu ra giữ NFT (phòng thủ). Ô ĐẦU TIÊN cho phần tăng đủ.
test sweep_rejects_two_ledger_outputs() {
  !withdraw_ok(
    sweep([ledger(0), inbox_utxo(2_000_000, 100)], [ledger(100), ledger(0)]),
  )
}

// ─── Mặt spend: chỉ đòi lượt rút của chính script ─────────────────────────────

/// Không có lượt rút nào: phép kiểm gom không chạy, ô hộp thư không được tiêu.
test spend_requires_the_own_withdrawal() {
  let body = sweep([ledger(0), inbox_utxo(2_000_000, 100)], [ledger(100)])
  !spend_ok(ref_at(1), Transaction { ..body, withdrawals: [] })
}

/// Lượt rút của một script KHÁC (ở đây là băm kho) không thay được lượt rút của hộp thư.
test spend_rejects_a_withdrawal_of_another_script() {
  let body = sweep([ledger(0), inbox_utxo(2_000_000, 100)], [ledger(100)])
  !spend_ok(
    ref_at(1),
    Transaction { ..body, withdrawals: [Pair(Script(vault_hash), 0)] },
  )
}

// ─── Mặt publish ──────────────────────────────────────────────────────────────

test publish_allows_registering_the_stake_credential() {
  publish_ok(
    RegisterCredential { credential: Script(inbox_hash), deposit: Never },
  )
}

/// Huỷ đăng ký: người huỷ nhận cọc của người khác và làm hỏng mọi lần gom sau đó.
test publish_rejects_unregistering_the_stake_credential() {
  !publish_ok(
    UnregisterCredential { credential: Script(inbox_hash), refund: Never },
  )
}

test publish_rejects_delegating_the_stake_credential() {
  !publish_ok(
    DelegateCredential {
      credential: Script(inbox_hash),
      delegate: DelegateBlockProduction {
        stake_pool: #"77777777777777777777777777777777777777777777777777777777",
      },
    },
  )
}

// ─── Hoàn min-ADA theo datum (v2) ─────────────────────────────────────────────

const feecover_key: ByteArray =
  #"88888888888888888888888888888888888888888888888888888888"

const other_feecover_key: ByteArray =
  #"99999999999999999999999999999999999999999999999999999999"

const refund_script_hash: ByteArray =
  #"abababababababababababababababababababababababababababab"

fn feecover() -> Credential {
  VerificationKey(feecover_key)
}

fn other_feecover() -> Credential {
  VerificationKey(other_feecover_key)
}

/// UTxO hộp thư do Feecover ứng min-ADA: datum `InboxDatum { refund }`.
fn refund_inbox(lovelace: Int, carp: Int, refund: Credential) -> Output {
  script_output(
    inbox_hash,
    value_with_carp(lovelace, carp),
    inline(InboxDatum { refund }),
  )
}

/// UTxO hộp thư mang một datum tuỳ ý (để thử datum sai hình).
fn inbox_with_datum(lovelace: Int, carp: Int, datum: Data) -> Output {
  script_output(inbox_hash, value_with_carp(lovelace, carp), inline(datum))
}

/// Đầu ra enterprise trả `lovelace` tới payment credential `credential`.
fn paid_to(credential: Credential, lovelace: Int) -> Output {
  wallet_output(
    Address { payment_credential: credential, stake_credential: None },
    from_lovelace(lovelace),
  )
}

/// Mặt `spend` khi ô mang datum (mặt spend không đọc datum; bài chỉ để chắc nó không vỡ).
fn spend_with_datum_ok(
  own_ref: OutputReference,
  datum: Data,
  tx_body: Transaction,
) -> Bool {
  fee_inbox.spend(
    carp_policy,
    carp_name,
    vault_hash,
    Some(datum),
    void(),
    own_ref,
    tx_body,
  )
}

test refund_fee_stays_within_its_cap() {
  and {
    refund_fee >= 0,
    refund_fee <= 200_000,
  }
}

/// CỰC DƯƠNG. Một ô có hoàn: lovelace − τ về Feecover, τ về người gom. Cả hai mặt qua.
test a_refund_cell_returns_its_lovelace_minus_the_fee() {
  let body =
    sweep(
      [ledger(0), refund_inbox(2_000_000, 100, feecover())],
      [
        ledger(100),
        paid_to(feecover(), 2_000_000 - refund_fee),
        paid_to(VerificationKey(stranger_key), refund_fee),
      ],
    )
  and {
    withdraw_ok(body),
    spend_with_datum_ok(ref_at(1), InboxDatum { refund: feecover() }, body),
  }
}

/// CỰC DƯƠNG. Ba ô cùng credential, một đầu ra hoàn gộp đủ cho cả ba.
test refund_cells_of_one_credential_are_paid_by_one_output() {
  withdraw_ok(
    sweep(
      [
        ledger(0),
        refund_inbox(2_000_000, 100, feecover()),
        refund_inbox(1_500_000, 100, feecover()),
        refund_inbox(3_000_000, 100, feecover()),
      ],
      [ledger(300), paid_to(feecover(), 6_500_000 - 3 * refund_fee)],
    ),
  )
}

/// CỰC DƯƠNG. Ba ô ba credential (hai khoá + một script), mỗi bên nhận đúng phần mình.
/// Đầu ra tới script hoàn không có datum.
test refund_cells_of_distinct_credentials_each_get_their_share() {
  withdraw_ok(
    sweep(
      [
        ledger(0),
        refund_inbox(2_000_000, 100, feecover()),
        refund_inbox(1_500_000, 100, other_feecover()),
        refund_inbox(3_000_000, 100, Script(refund_script_hash)),
      ],
      [
        ledger(300),
        script_output(
          refund_script_hash,
          from_lovelace(3_000_000 - refund_fee),
          NoDatum,
        ),
        paid_to(other_feecover(), 1_500_000 - refund_fee),
        paid_to(feecover(), 2_000_000 - refund_fee),
      ],
    ),
  )
}

/// CỰC DƯƠNG. Hoàn chia hai đầu ra cùng payment credential; một đầu ra có phần uỷ quyền và
/// datum lạ — chỉ payment credential được so.
test a_refund_may_be_split_across_outputs_with_any_stake_part_and_datum() {
  let delegated =
    Output {
      ..paid_to(feecover(), 1_000_000),
      address: Address {
        payment_credential: feecover(),
        stake_credential: Some(address.Inline(VerificationKey(stranger_key))),
      },
      datum: inline(42),
    }
  withdraw_ok(
    sweep(
      [ledger(0), refund_inbox(2_000_000, 100, feecover())],
      [ledger(100), delegated, paid_to(feecover(), 1_000_000 - refund_fee)],
    ),
  )
}

/// CỰC DƯƠNG. Ô cũ không datum và ô có hoàn trong cùng lần gom: lovelace ô cũ vẫn tự do.
test datumless_and_refund_cells_mix_in_one_sweep() {
  withdraw_ok(
    sweep(
      [
        ledger(0),
        inbox_utxo(5_000_000, 100),
        refund_inbox(2_000_000, 100, feecover()),
      ],
      [
        ledger(200),
        paid_to(VerificationKey(stranger_key), 5_000_000 + refund_fee),
        paid_to(feecover(), 2_000_000 - refund_fee),
      ],
    ),
  )
}

/// CỰC ÂM của `a_refund_cell_returns_its_lovelace_minus_the_fee`: thiếu đúng 1 lovelace.
test a_refund_short_by_one_lovelace_is_rejected() {
  !withdraw_ok(
    sweep(
      [ledger(0), refund_inbox(2_000_000, 100, feecover())],
      [ledger(100), paid_to(feecover(), 2_000_000 - refund_fee - 1)],
    ),
  )
}

/// CỰC ÂM. Hai ô cùng credential, đầu ra chỉ đủ cho MỘT ô. So từng ô với "có một đầu ra
/// đủ" thì đầu ra này thoả cả hai; chỉ phép so gộp theo credential chặn được.
test two_refund_cells_of_one_credential_cannot_share_one_refund() {
  !withdraw_ok(
    sweep(
      [
        ledger(0),
        refund_inbox(2_000_000, 100, feecover()),
        refund_inbox(2_000_000, 100, feecover()),
      ],
      [ledger(200), paid_to(feecover(), 2_000_000 - refund_fee)],
    ),
  )
}

/// CỰC ÂM của bài trên, một lovelace dưới tổng: gộp đủ thì qua, thiếu 1 thì đỏ.
test two_refund_cells_reject_a_refund_one_below_their_total() {
  !withdraw_ok(
    sweep(
      [
        ledger(0),
        refund_inbox(2_000_000, 100, feecover()),
        refund_inbox(2_000_000, 100, feecover()),
      ],
      [ledger(200), paid_to(feecover(), 4_000_000 - 2 * refund_fee - 1)],
    ),
  )
}

/// CỰC ÂM. Đúng tiền nhưng sai credential.
test a_refund_to_the_wrong_credential_is_rejected() {
  !withdraw_ok(
    sweep(
      [ledger(0), refund_inbox(2_000_000, 100, feecover())],
      [ledger(100), paid_to(other_feecover(), 2_000_000 - refund_fee)],
    ),
  )
}

/// CỰC ÂM. Cùng 28 byte băm nhưng khác loại credential (Script thay VerificationKey).
test a_refund_to_a_script_with_the_same_hash_is_rejected() {
  !withdraw_ok(
    sweep(
      [ledger(0), refund_inbox(2_000_000, 100, feecover())],
      [
        ledger(100),
        script_output(
          feecover_key,
          from_lovelace(2_000_000 - refund_fee),
          NoDatum,
        ),
      ],
    ),
  )
}

/// CỰC ÂM. Người gom giữ hết lovelace của ô có hoàn.
test the_sweeper_cannot_keep_a_refund_cell_lovelace() {
  !withdraw_ok(
    sweep(
      [ledger(0), refund_inbox(2_000_000, 100, feecover())],
      [ledger(100), paid_to(VerificationKey(stranger_key), 2_000_000)],
    ),
  )
}

/// CỰC ÂM. Trả dư cho một credential không bù được phần thiếu của credential khác.
test overpaying_one_credential_cannot_cover_another() {
  !withdraw_ok(
    sweep(
      [
        ledger(0),
        refund_inbox(2_000_000, 100, feecover()),
        refund_inbox(2_000_000, 100, other_feecover()),
      ],
      [ledger(200), paid_to(feecover(), 4_000_000 - 2 * refund_fee)],
    ),
  )
}

/// CỰC ÂM. Hoàn đủ mà CARP không vào sổ: luật CARP vẫn nguyên.
test a_paid_refund_does_not_waive_the_carp_rule() {
  !withdraw_ok(
    sweep(
      [ledger(0), refund_inbox(2_000_000, 100, feecover())],
      [ledger(99), paid_to(feecover(), 2_000_000 - refund_fee)],
    ),
  )
}

/// Datum sai hình ⟹ gom như ô không datum: người gom lấy trọn lovelace, không ai đòi hoàn.
/// Mỗi ô là một kiểu sai khác nhau; nếu MỘT ô bị đọc nhầm thành ô có hoàn thì bài đỏ.
test malformed_datums_are_swept_like_datumless_cells() {
  let short_hash = #"88888888888888888888888888888888888888888888888888888888"
  let malformed: List<Data> =
    [
      // Không phải Constr.
      as_data(42),
      // Đúng Constr 0 nhưng không có trường nào.
      as_data(FirstCase),
      // Sai chỉ số constructor: `Constr 1 [refund]`.
      as_data(SecondCase { refund: feecover() }),
      // Đúng Constr 0 nhưng trường không phải Credential.
      as_data(Wrap { value: 5 }),
      // Credential mang băm 27 byte: không địa chỉ nào trên chuỗi khớp được.
      as_data(
        InboxDatum { refund: VerificationKey(bytearray.drop(short_hash, 1)) },
      ),
      // Credential mang băm 29 byte.
      as_data(
        InboxDatum { refund: Script(bytearray.concat(short_hash, #"00")) },
      ),
    ]
  let cells =
    list.map(malformed, fn(datum) { inbox_with_datum(2_000_000, 100, datum) })
  let hashed =
    script_output(
      inbox_hash,
      value_with_carp(2_000_000, 100),
      DatumHash(
        #"0000000000000000000000000000000000000000000000000000000000000000",
      ),
    )
  withdraw_ok(
    sweep(
      [ledger(0), hashed, ..cells],
      [ledger(700), paid_to(VerificationKey(stranger_key), 14_000_000)],
    ),
  )
}

/// Ghi lại hành vi giải mã khi datum có THÊM trường sau `refund`: xem bài để biết nhánh nào.
test a_datum_with_an_extra_field_is_swept_like_a_datumless_cell() {
  withdraw_ok(
    sweep(
      [
        ledger(0),
        inbox_with_datum(2_000_000, 100, as_data(Pair2 { a: feecover(), b: 7 })),
      ],
      [ledger(100), paid_to(VerificationKey(stranger_key), 2_000_000)],
    ),
  )
}

type Wrap {
  value: Int,
}

type TwoCases {
  FirstCase
  SecondCase { refund: Credential }
}

type Pair2 {
  a: Credential,
  b: Int,
}

fn as_data(value: Data) -> Data {
  value
}

// ─────────────────────────────────────────────────────────────────────────────
// NGÂN SÁCH: một lần gom N ô hộp thư + 1 ô sổ, N = 1, 10, 20, 50.
//
// Với mỗi N: "chỉ dựng" đo chi phí dựng giao dịch giả; "spend" = dựng + N lượt mặt spend
// (mỗi ô hộp thư là một lượt chạy riêng trên chuỗi); "withdraw" = dựng + một lượt mặt
// withdraw. Hiệu với bài "chỉ dựng" là chi phí validator.
// ─────────────────────────────────────────────────────────────────────────────

fn sweep_of(n: Int) -> Transaction {
  sweep(
    [
      ledger(0),
      ..list.map(list.range(1, n), fn(_) { inbox_utxo(2_000_000, 100) })
    ],
    [ledger(100 * n)],
  )
}

fn all_spends(n: Int) -> Bool {
  let body = sweep_of(n)
  list.all(list.range(1, n), fn(i) { spend_ok(ref_at(i), body) })
}

test budget_inbox_n01_build_only() {
  list.length(sweep_of(1).inputs) == 2
}

test budget_inbox_n01_spends() {
  all_spends(1)
}

test budget_inbox_n01_withdraw() {
  withdraw_ok(sweep_of(1))
}

test budget_inbox_n10_build_only() {
  list.length(sweep_of(10).inputs) == 11
}

test budget_inbox_n10_spends() {
  all_spends(10)
}

test budget_inbox_n10_withdraw() {
  withdraw_ok(sweep_of(10))
}

test budget_inbox_n20_build_only() {
  list.length(sweep_of(20).inputs) == 21
}

test budget_inbox_n20_spends() {
  all_spends(20)
}

test budget_inbox_n20_withdraw() {
  withdraw_ok(sweep_of(20))
}

test budget_inbox_n50_build_only() {
  list.length(sweep_of(50).inputs) == 51
}

test budget_inbox_n50_spends() {
  all_spends(50)
}

test budget_inbox_n50_withdraw() {
  withdraw_ok(sweep_of(50))
}

// ─────────────────────────────────────────────────────────────────────────────
// NGÂN SÁCH v2: một lần gom N ô CÓ HOÀN + 1 ô sổ, N = 1, 10, 20, 50 (và 60, 70 để tìm trần).
//
// "same": mọi ô cùng một credential hoàn, một đầu ra hoàn gộp. "distinct": mỗi ô một
// credential, mỗi ô một đầu ra hoàn (ca xấu nhất của bảng nợ: N dòng, N đầu ra).
// Mặt spend không đọc datum nên chi phí spend bằng bài `budget_inbox_nXX_spends`.
// ─────────────────────────────────────────────────────────────────────────────

fn nth_credential(i: Int) -> Credential {
  VerificationKey(bytearray.from_int_big_endian(i, 28))
}

fn refund_sweep_of(n: Int, distinct: Bool) -> Transaction {
  let cells =
    list.map(
      list.range(1, n),
      fn(i) {
        refund_inbox(
          2_000_000,
          100,
          if distinct {
            nth_credential(i)
          } else {
            feecover()
          },
        )
      },
    )
  let refunds =
    if distinct {
      list.map(
        list.range(1, n),
        fn(i) { paid_to(nth_credential(i), 2_000_000 - refund_fee) },
      )
    } else {
      [paid_to(feecover(), n * ( 2_000_000 - refund_fee ))]
    }
  sweep([ledger(0), ..cells], [ledger(100 * n), ..refunds])
}

test budget_refund_same_n01_build_only() {
  list.length(refund_sweep_of(1, False).inputs) == 2
}

test budget_refund_same_n01_withdraw() {
  withdraw_ok(refund_sweep_of(1, False))
}

test budget_refund_same_n10_build_only() {
  list.length(refund_sweep_of(10, False).inputs) == 11
}

test budget_refund_same_n10_withdraw() {
  withdraw_ok(refund_sweep_of(10, False))
}

test budget_refund_same_n20_build_only() {
  list.length(refund_sweep_of(20, False).inputs) == 21
}

test budget_refund_same_n20_withdraw() {
  withdraw_ok(refund_sweep_of(20, False))
}

test budget_refund_same_n50_build_only() {
  list.length(refund_sweep_of(50, False).inputs) == 51
}

test budget_refund_same_n50_withdraw() {
  withdraw_ok(refund_sweep_of(50, False))
}

test budget_refund_distinct_n01_build_only() {
  list.length(refund_sweep_of(1, True).inputs) == 2
}

test budget_refund_distinct_n01_withdraw() {
  withdraw_ok(refund_sweep_of(1, True))
}

test budget_refund_distinct_n10_build_only() {
  list.length(refund_sweep_of(10, True).inputs) == 11
}

test budget_refund_distinct_n10_withdraw() {
  withdraw_ok(refund_sweep_of(10, True))
}

test budget_refund_distinct_n20_build_only() {
  list.length(refund_sweep_of(20, True).inputs) == 21
}

test budget_refund_distinct_n20_withdraw() {
  withdraw_ok(refund_sweep_of(20, True))
}

test budget_refund_distinct_n30_build_only() {
  list.length(refund_sweep_of(30, True).inputs) == 31
}

test budget_refund_distinct_n30_withdraw() {
  withdraw_ok(refund_sweep_of(30, True))
}

test budget_refund_distinct_n40_build_only() {
  list.length(refund_sweep_of(40, True).inputs) == 41
}

test budget_refund_distinct_n40_withdraw() {
  withdraw_ok(refund_sweep_of(40, True))
}

test budget_refund_same_n60_build_only() {
  list.length(refund_sweep_of(60, False).inputs) == 61
}

test budget_refund_same_n60_withdraw() {
  withdraw_ok(refund_sweep_of(60, False))
}

test budget_refund_distinct_n50_build_only() {
  list.length(refund_sweep_of(50, True).inputs) == 51
}

test budget_refund_distinct_n50_withdraw() {
  withdraw_ok(refund_sweep_of(50, True))
}

test budget_refund_distinct_n60_build_only() {
  list.length(refund_sweep_of(60, True).inputs) == 61
}

test budget_refund_distinct_n60_withdraw() {
  withdraw_ok(refund_sweep_of(60, True))
}

test budget_refund_distinct_n70_build_only() {
  list.length(refund_sweep_of(70, True).inputs) == 71
}

test budget_refund_distinct_n70_withdraw() {
  withdraw_ok(refund_sweep_of(70, True))
}

test budget_inbox_n60_build_only() {
  list.length(sweep_of(60).inputs) == 61
}

test budget_inbox_n60_spends() {
  all_spends(60)
}

test budget_inbox_n70_build_only() {
  list.length(sweep_of(70).inputs) == 71
}

test budget_inbox_n70_spends() {
  all_spends(70)
}
