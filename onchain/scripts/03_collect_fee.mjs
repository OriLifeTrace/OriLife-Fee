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
/// ví) hoặc `Constr 1 [băm script]`, băm đúng 28 byte. Hình khác ⟹ `null`: validator gom ô đó
/// như ô không datum, nên kịch bản cũng không trả hoàn (`fee_inbox.ak` ▸ `add_refund_owed`).
function refundOf(utxo) {
  if (!utxo.datum) return null;
  let d;
  try { d = Data.from(utxo.datum); } catch { return null; }
  if (!(d instanceof Constr) || d.index !== 0 || d.fields.length !== 1) return null;
  const c = d.fields[0];
  if (!(c instanceof Constr) || c.index > 1 || c.fields.length !== 1) return null;
  const hash = c.fields[0];
  if (typeof hash !== "string" || !/^[0-9a-f]{56}$/.test(hash)) return null;
  return { type: c.index === 0 ? "Key" : "Script", hash };
}

/// Trần số ô hộp thư mỗi lượt gom. `aiken check` cho N = 50 khoảng 8,4M mem trên trần 14M,
/// nhưng số đó chưa tính giải mã ScriptContext trên chuỗi; 30 là mức thận trọng tới khi có
/// số đo trên Preprod. Còn dư thì chạy lại kịch bản. Ô có hoàn mỗi ô một credential khác nhau
/// thì phép so hoàn tăng theo bình phương: đo bằng `aiken check` chạm trần mem ở khoảng 30 ô
/// cả giao dịch (cùng một credential thì khoảng 55), nên 30 vẫn là trần đúng cho ca xấu nhất.
const MAX_SWEEP = 30;

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
const inboxPick = sweepable(await lucid.utxosAt(scripts.inboxAddress), scripts.carpUnit, MAX_SWEEP);
const { ledger: vault, strays: allStrays } = splitVaultUtxos(
  await lucid.utxosAt(scripts.vaultAddress), scripts.vaultNftUnit,
);
const strayPick = sweepable(allStrays, scripts.carpUnit, MAX_STRAYS);
const inbox = inboxPick.picked;
const strays = strayPick.picked;
console.log("bỏ lại   ", inboxPick.skipped, "ô hộp thư +", strayPick.skipped, "ô ở địa chỉ kho (không CARP, datum không giải được, có script, hoặc quá trần)");
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
  const r = refundOf(u);
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
for (const { credential, lovelace } of owed.values()) {
  builder = builder.pay.ToAddress(credentialToAddress(NETWORK, credential), { lovelace });
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
