//// Hộp thư phí. Địa chỉ trung gian cho CARP phí nền tảng, dành cho những giao dịch không
//// kèm được `Collect` của kho phí (ví dụ giao dịch ConsumeMAGIC chỉ có thể trả CARP tới
//// một địa chỉ). Tiền ở đây chỉ có MỘT lối ra có nghĩa: vào sổ kho phí.
////
//// Ai cũng gom được, cố ý: không phụ thuộc OriLife. Lovelace và token khác nằm trong UTxO
//// hộp thư KHÔNG bị ràng — đó là phần thưởng cho người gom (min-ADA do bên trả phí nộp),
//// tức động cơ để bất kỳ ai chạy việc gom.
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
use cardano/address.{Credential, Script, from_verification_key}
use cardano/assets.{AssetName, PolicyId, from_lovelace, quantity_of}
use cardano/certificate.{
  Certificate, DelegateBlockProduction, DelegateCredential, RegisterCredential,
  UnregisterCredential,
}
use cardano/transaction.{Input, NoDatum, Output, OutputReference, Transaction}
use orilife/fixtures.{
  carp_name, carp_policy, inbox_hash, inline, input_from, ref_at, script_output,
  stranger_key, tx, value_with_carp, vault_hash, wallet_output, with_vault_nft,
}
use orilife/types.{VaultDatum, vault_nft_name}

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
    let (ledger_inputs, inbox_carp, vault_stray_carp) =
      list.foldr(
        tx.inputs,
        ([], 0, 0),
        fn(input, acc) {
          let (ledgers, inbox, strays) = acc
          let output = input.output
          let credential = output.address.payment_credential
          if credential == inbox_credential {
            (ledgers, inbox + carp_of(output, carp_policy, carp_name), strays)
          } else if holds_vault_nft(output, vault_hash) {
            ([output, ..ledgers], inbox, strays)
          } else if credential == vault_credential {
            (ledgers, inbox, strays + carp_of(output, carp_policy, carp_name))
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
        ledger_gain >= inbox_carp + vault_stray_carp
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
    inline(VaultDatum { collected: carp, skimmed: 0 }),
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
          inline(VaultDatum { collected: 0, skimmed: 0 }),
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
          inline(VaultDatum { collected: 100, skimmed: 0 }),
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
