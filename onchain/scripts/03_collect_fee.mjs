// Nộp phí vào hộp thư phí, rồi gom hộp thư vào sổ kho phí — hai giao dịch, đúng như đường thật.
//
// Đường thật: giao dịch ConsumeMAGIC không kèm được `Collect` (`consume.ak` chỉ nhận đầu vào
// script của chính nó và vault MAGIC), nên phí nền tảng bằng CARP chỉ là MỘT đầu ra tới địa
// chỉ hộp thư `fee_inbox`, không đầu vào script. Min-ADA của đầu ra đó do bên trả phí hộ ứng,
// nên đầu ra mang datum hoàn `InboxDatum { refund }` (`types.ak`). Bước 1 dưới đây đóng vai đầu
// ra đó, với `refund` là khoá của chính ví chạy kịch bản. Bước 2 là lượt gom: AI CŨNG chạy được,
// không cần chữ ký OriLife, miễn kho nhận đủ số CARP của mọi ô hộp thư qua `Collect` và mỗi ô
// có hoàn trả lại `lovelace − REFUND_FEE` cho đúng credential `refund` (`fee_inbox.ak` ▸ mặt
// `withdraw`). Người gom giữ `REFUND_FEE` mỗi ô có hoàn, và trọn ADA của ô không datum — đó là
// động cơ để người ngoài OriLife cũng gom.
//
// Ô lạc ở địa chỉ kho (UTxO gửi nhầm tới `fee_vault`, có hay không có datum) được gom cùng
// lượt: CARP của chúng cũng phải vào sổ (`fee_vault.ak`, nhánh đầu vào không giữ NFT).

import { Constr, Data, credentialToAddress, paymentCredentialOf } from "@lucid-evolution/lucid";
import {
  connect, state, saveState, buildScripts, splitVaultUtxos, sweepable, explorer, awaitTx, CARP_SCALE,
  NETWORK,
} from "./common.mjs";
import { VaultDatum, VaultRedeemer } from "./schemas.mjs";

const FEE_CARP = 1_000n;

/// Phần người gom giữ lại mỗi ô có hoàn. Chép từ `fee_inbox.ak` ▸ hằng `refund_fee` (nhánh
/// `claude/fee-inbox-refund-datum`, 04/10/2026). Lệch với bản trên chuỗi thì: nhỏ hơn ⟹ trả dư,
/// không ai mất; lớn hơn ⟹ nút mạng từ chối lượt gom, không có gì mất.
const REFUND_FEE = 100_000n;

/// `InboxDatum { refund }` = `Constr 0 [Credential]`, `Credential` = `Constr 0 [khoá]` (khoá
/// ví) hoặc `Constr 1 [băm script]`, băm đúng 28 byte, và không phải băm kho `vaultHash`. Hình
/// khác ⟹ `null`: validator gom ô đó như ô không datum, nên kịch bản cũng không trả hoàn
/// (`fee_inbox.ak` ▸ `add_refund_owed`). Ca băm kho phải khớp validator theo cả hai chiều: dựng
/// đầu ra hoàn về kho thì kho bác lượt gom (đòi đúng một đầu ra ở địa chỉ mình).
function refundOf(utxo, vaultHash) {
  if (!utxo.datum) return null;
  let d;
  try { d = Data.from(utxo.datum); } catch { return null; }
  if (!(d instanceof Constr) || d.index !== 0 || d.fields.length !== 1) return null;
  const c = d.fields[0];
  if (!(c instanceof Constr) || c.index > 1 || c.fields.length !== 1) return null;
  const hash = c.fields[0];
  if (typeof hash !== "string" || !/^[0-9a-f]{56}$/.test(hash)) return null;
  if (c.index === 1 && hash === vaultHash) return null;
  return { type: c.index === 0 ? "Key" : "Script", hash };
}

/// Chọn ô hộp thư cho một lượt từ danh sách đã xếp CARP giảm dần: tối đa `maxCells` ô, và các ô
/// có hoàn mang tối đa `maxCredentials` credential khác nhau. Ô mang credential thứ
/// `maxCredentials + 1` bị bỏ lại cho lượt sau; ô không datum và ô thuộc credential đã chọn thì
/// vẫn được nhặt tiếp.
function pickInbox(sorted, vaultHash, maxCells, maxCredentials) {
  const credentials = new Set();
  const picked = [];
  for (const u of sorted) {
    if (picked.length === maxCells) break;
    const r = refundOf(u, vaultHash);
    if (r) {
      const key = `${r.type}:${r.hash}`;
      if (!credentials.has(key)) {
        if (credentials.size === maxCredentials) continue;
        credentials.add(key);
      }
    }
    picked.push(u);
  }
  return picked;
}

/// Trần số ô hộp thư mỗi lượt gom. `aiken check` cho N = 50 khoảng 8,4M mem trên trần 14M,
/// nhưng số đó chưa tính giải mã ScriptContext trên chuỗi; 30 là mức thận trọng tới khi có
/// số đo trên Preprod. Còn dư thì chạy lại kịch bản.
const MAX_SWEEP = 30;

/// Trần số credential hoàn khác nhau mỗi lượt gom. Phép so hoàn ở mặt `withdraw` tốn theo
/// (số ô × số credential), nên trần số ô một mình KHÔNG đủ: ai cũng gửi được ô có hoàn vào hộp
/// thư, và ô mỗi cái một credential đẩy lượt gom quá trần mem. Đo trên Emulator (phase-two chạy
/// thật, 04/10/2026, kèm 2 ô lạc có CARP): 28 ô hộp thư mỗi ô một credential vượt trần, 27 ô
/// tổng 13,9M/14M. Với 30 ô + 4 ô lạc có CARP: 17 credential vượt trần; ở trần 10 (ca xấu nhất:
/// 30 ô, 10 credential, 4 ô lạc có CARP) tổng 12,4M/14M, cùng credential 10,8M.
const MAX_REFUND_CREDENTIALS = 10;

/// Trần số ô lạc ở địa chỉ kho mỗi lượt. Mỗi ô lạc chạy lại validator kho trên toàn bộ đầu vào
/// nên chi phí tăng theo bình phương; 16 ô chỉ-ADA đã đủ làm lượt gom vượt ngân sách. Chỉ ô
/// lạc CÓ CARP mới cần vào sổ — ô chỉ-ADA bỏ yên, không hại gì.
const MAX_STRAYS = 4;

const s = state();
const lucid = await connect();
const scripts = buildScripts({
  carpPolicy: s.carpPolicy, carpName: s.carpName, seed: s.seed,
});

// ── Bước 1: một đầu ra CARP tới hộp thư, datum hoàn về chính ví này ──────────
const amountIn = FEE_CARP * CARP_SCALE;
const own = paymentCredentialOf(await lucid.wallet().address());
const refundDatum = Data.to(new Constr(0, [new Constr(own.type === "Key" ? 0 : 1, [own.hash])]));
const payTx = await lucid
  .newTx()
  .pay.ToContract(
    scripts.inboxAddress,
    { kind: "inline", value: refundDatum },
    { lovelace: 1_500_000n, [scripts.carpUnit]: amountIn },
  )
  .complete();
const payHash = await (await payTx.sign.withWallet().complete()).submit();
console.log("nộp phí  ", FEE_CARP, "tCARP vào hộp thư");
console.log("tx       ", payHash, explorer(payHash));
await awaitTx(lucid, payHash, "nộp phí:");

// ── Bước 2: gom hộp thư (và ô lạc ở địa chỉ kho) vào sổ ──────────────────────
const inboxUtxos = await lucid.utxosAt(scripts.inboxAddress);
const inbox = pickInbox(
  sweepable(inboxUtxos, scripts.carpUnit, inboxUtxos.length).picked,
  scripts.vaultHash, MAX_SWEEP, MAX_REFUND_CREDENTIALS,
);
const { ledger: vault, strays: allStrays } = splitVaultUtxos(
  await lucid.utxosAt(scripts.vaultAddress), scripts.vaultNftUnit,
);
const strayPick = sweepable(allStrays, scripts.carpUnit, MAX_STRAYS);
const strays = strayPick.picked;
console.log("bỏ lại   ", inboxUtxos.length - inbox.length, "ô hộp thư +", strayPick.skipped, "ô ở địa chỉ kho (không CARP, datum không giải được, có script, hoặc quá trần)");
const carpOf = (u) => u.assets[scripts.carpUnit] ?? 0n;
const amount = [...inbox, ...strays].reduce((acc, u) => acc + carpOf(u), 0n);
if (amount <= 0n) { console.log("hộp thư không có CARP để gom"); process.exit(0); }

const before = Data.from(vault.datum, VaultDatum);
// `...before` chở `operator_key` sang nguyên vẹn — `Collect` đổi khoá là bị hợp đồng bác.
const after = { ...before, collected: before.collected + amount };
const collect = Data.to({ Collect: { amount } }, VaultRedeemer);

console.log("gom      ", inbox.length, "ô hộp thư +", strays.length, "ô lạc =", amount, "đơn vị");
console.log("sổ trước ", before.collected, "/", before.skimmed);
console.log("sổ sau   ", after.collected, "/", after.skimmed);

// Nợ hoàn gộp theo credential, đúng phép so của validator: một đầu ra cho mỗi credential.
const owed = new Map();
for (const u of inbox) {
  const r = refundOf(u, scripts.vaultHash);
  if (!r) continue;
  const key = `${r.type}:${r.hash}`;
  const prev = owed.get(key) ?? { credential: r, lovelace: 0n };
  owed.set(key, { credential: r, lovelace: prev.lovelace + u.assets.lovelace - REFUND_FEE });
}
console.log("hoàn     ", owed.size, "credential,", [...owed.values()].reduce((a, o) => a + o.lovelace, 0n), "lovelace");

// Ô lạc đi qua cùng validator kho, redeemer phải đọc được thành `VaultRedeemer`. Bộ dựng
// không nhận `collectFrom([])`, nên chỉ thêm nhóm nào có ô.
let builder = lucid.newTx().collectFrom([...strays, vault], collect)
  .attach.SpendingValidator(scripts.vaultScript);
if (inbox.length > 0) {
  // Ô hộp thư: `spend` chỉ kiểm có withdrawal của chính script hộp thư; redeemer tuỳ ý.
  // Rút 0 lovelace để mặt `withdraw` chạy MỘT lần, kiểm cả lô.
  builder = builder
    .collectFrom(inbox, Data.void())
    .withdraw(scripts.inboxRewardAddress, 0n, Data.void())
    .attach.SpendingValidator(scripts.inboxScript)
    .attach.WithdrawalValidator(scripts.inboxScript);
}
// Đầu ra hoàn có hình cố định, khác hình thì validator không đếm (`fee_inbox.ak` ▸
// `refunds_paid`): địa chỉ enterprise (không phần uỷ quyền), datum inline = băm hộp thư dạng
// Bytes (thẻ chống hai phiên bản hộp thư dùng chung một đầu ra), không reference script.
const refundTag = Data.to(scripts.inboxHash);
for (const { credential, lovelace } of owed.values()) {
  builder = builder.pay.ToContract(
    credentialToAddress(NETWORK, credential),
    { kind: "inline", value: refundTag },
    { lovelace },
  );
}
const sweepTx = await builder
  .pay.ToContract(
    scripts.vaultAddress,
    { kind: "inline", value: Data.to(after, VaultDatum) },
    {
      lovelace: vault.assets.lovelace,
      [scripts.vaultNftUnit]: 1n,
      [scripts.carpUnit]: carpOf(vault) + amount,
    },
  )
  .complete();

const sweepHash = await (await sweepTx.sign.withWallet().complete()).submit();
console.log("tx       ", sweepHash, explorer(sweepHash));
await awaitTx(lucid, sweepHash, "gom vào sổ:");
saveState({ payInboxTx: payHash, collectTx: sweepHash, collected: after.collected.toString() });
