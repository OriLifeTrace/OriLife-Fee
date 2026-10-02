// Nộp phí vào hộp thư phí, rồi gom hộp thư vào sổ kho phí — hai giao dịch, đúng như đường thật.
//
// Đường thật: giao dịch ConsumeMAGIC không kèm được `Collect` (`consume.ak` chỉ nhận đầu vào
// script của chính nó và vault MAGIC), nên phí nền tảng bằng CARP chỉ là MỘT đầu ra tới địa
// chỉ hộp thư `fee_inbox` — không datum, không đầu vào script. Bước 1 dưới đây đóng vai đầu ra
// đó. Bước 2 là lượt gom: AI CŨNG chạy được, không cần chữ ký OriLife, miễn kho nhận đủ số
// CARP của mọi ô hộp thư qua `Collect` (`fee_inbox.ak` ▸ mặt `withdraw`). ADA giữ chỗ của các
// ô hộp thư về tay người gom — đó là động cơ để người ngoài OriLife cũng gom.
//
// Ô lạc ở địa chỉ kho (UTxO gửi nhầm tới `fee_vault`, có hay không có datum) được gom cùng
// lượt: CARP của chúng cũng phải vào sổ (`fee_vault.ak`, nhánh đầu vào không giữ NFT).

import { Data } from "@lucid-evolution/lucid";
import {
  connect, state, saveState, buildScripts, splitVaultUtxos, sweepable, explorer, awaitTx, CARP_SCALE,
} from "./common.mjs";
import { VaultDatum, VaultRedeemer } from "./schemas.mjs";

const FEE_CARP = 1_000n;

/// Trần số ô hộp thư mỗi lượt gom. `aiken check` cho N = 50 khoảng 8,4M mem trên trần 14M,
/// nhưng số đó chưa tính giải mã ScriptContext trên chuỗi; 30 là mức thận trọng tới khi có
/// số đo trên Preprod. Còn dư thì chạy lại kịch bản.
const MAX_SWEEP = 30;

/// Trần số ô lạc ở địa chỉ kho mỗi lượt. Mỗi ô lạc chạy lại validator kho trên toàn bộ đầu vào
/// nên chi phí tăng theo bình phương; 16 ô chỉ-ADA đã đủ làm lượt gom vượt ngân sách. Chỉ ô
/// lạc CÓ CARP mới cần vào sổ — ô chỉ-ADA bỏ yên, không hại gì.
const MAX_STRAYS = 4;

const s = state();
const lucid = await connect();
const scripts = buildScripts({
  carpPolicy: s.carpPolicy, carpName: s.carpName, operatorKeyHash: s.operatorKeyHash, seed: s.seed,
});

// ── Bước 1: một đầu ra CARP tới hộp thư, không datum ─────────────────────────
const amountIn = FEE_CARP * CARP_SCALE;
const payTx = await lucid
  .newTx()
  .pay.ToAddress(scripts.inboxAddress, { lovelace: 1_500_000n, [scripts.carpUnit]: amountIn })
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
const after = { collected: before.collected + amount, skimmed: before.skimmed };
const collect = Data.to({ Collect: { amount } }, VaultRedeemer);

console.log("gom      ", inbox.length, "ô hộp thư +", strays.length, "ô lạc =", amount, "đơn vị");
console.log("sổ trước ", before.collected, "/", before.skimmed);
console.log("sổ sau   ", after.collected, "/", after.skimmed);

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
