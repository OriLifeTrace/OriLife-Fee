// Trích 10% sang kho tạm. Con số không do kịch bản này chọn — nó tính lại từ chính sổ
// trên chuỗi, đúng công thức mà hợp đồng sẽ kiểm.

import { Data } from "@lucid-evolution/lucid";
import { connect, state, saveState, buildScripts, explorer, awaitTx, SKIM_BPS, CARP_SCALE } from "./common.mjs";
import { VaultDatum, EscrowDatum, VaultRedeemer } from "./schemas.mjs";

const s = state();
const lucid = await connect();
const scripts = buildScripts({
  carpPolicy: s.carpPolicy, carpName: s.carpName, operatorKeyHash: s.operatorKeyHash,
});

const utxos = await lucid.utxosAt(scripts.vaultAddress);
if (utxos.length !== 1) throw new Error(`kho phải có đúng 1 UTxO, đang thấy ${utxos.length}`);
const vault = utxos[0];
const before = Data.from(vault.datum, VaultDatum);

// Nghĩa vụ = (collected × bps / 10000) LÀM TRÒN LÊN, trừ phần đã trích. Làm tròn lên
// vì hợp đồng làm tròn lên; dùng phép chia thường ở đây là kịch bản tự trích thiếu một
// đơn vị so với trần, và kho sẽ không bao giờ đóng lại được (`Close` đòi nghĩa vụ về 0).
const obligation =
  (before.collected * BigInt(SKIM_BPS) + 9_999n) / 10_000n - before.skimmed;
if (obligation <= 0n) { console.log("không còn nghĩa vụ nào để trích"); process.exit(0); }

const after = { collected: before.collected, skimmed: before.skimmed + obligation };
const held = vault.assets[scripts.carpUnit] ?? 0n;

console.log("sổ trước ", before.collected, "/", before.skimmed);
console.log("nghĩa vụ ", obligation, "=", Number(obligation / CARP_SCALE), "tCARP");
console.log("sổ sau   ", after.collected, "/", after.skimmed);

const tx = await lucid
  .newTx()
  .collectFrom([vault], Data.to({ Skim: { amount: obligation } }, VaultRedeemer))
  .attach.SpendingValidator(scripts.vaultScript)
  .pay.ToContract(
    scripts.vaultAddress,
    { kind: "inline", value: Data.to(after, VaultDatum) },
    { lovelace: vault.assets.lovelace, [scripts.carpUnit]: held - obligation },
  )
  .pay.ToContract(
    scripts.escrowAddress,
    {
      kind: "inline",
      // `vault` ràng khoản trích này vào ĐÚNG instance kho phí đang chi; `parent: null`
      // khai nó là khoản MỚI, không phải phần dư của một ô kho tạm nào. Sai một trong
      // hai thì hợp đồng từ chối — xem `escrow_receives` trong `fee_vault.ak`.
      value: Data.to(
        { carp: obligation, vault: scripts.vaultHash, parent: null },
        EscrowDatum,
      ),
    },
    { lovelace: 3_000_000n, [scripts.carpUnit]: obligation },
  )
  .complete();

const signed = await tx.sign.withWallet().complete();
const txHash = await signed.submit();
console.log("tx       ", txHash);
console.log("         ", explorer(txHash));
await awaitTx(lucid, txHash, "trích 10%:");
saveState({ skimTx: txHash, skimmed: after.skimmed.toString() });
