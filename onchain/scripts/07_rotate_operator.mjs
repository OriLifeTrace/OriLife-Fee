// Xoay khoá vận hành của kho phí TẠI CHỖ: ô sổ ở lại đúng địa chỉ, giữ NFT, giữ nguyên giá trị
// và hai con số sổ; chỉ `operator_key` trong datum đổi.
//
// Vì sao không "đóng kho rồi mở kho mới": `Close` đốt NFT sổ, và `fee_inbox` bake băm kho cũ,
// chỉ gom được vào một sổ còn giữ NFT ⟹ mọi ô CARP còn ở hộp thư mất đường vào sổ mãi mãi.
// `Rotate` không đổi băm kho, nên hộp thư, kho tạm, NFT sổ đều nguyên.
//
// Hợp đồng đòi HAI chữ ký (`fee_vault.ak` ▸ nhánh `Rotate`):
//   · khoá HIỆN TẠI (trong datum ô sổ) — ví đang chọn phải là khoá đó;
//   · khoá MỚI — chứng minh có người cầm nó; ghi nhầm một băm là mất vĩnh viễn
//     `Operate`/`Rotate`/`Close`.
//
// Khoá mới đi vào tiến trình qua biến môi trường `NEW_OPERATOR_SEED` (cụm từ khôi phục của ví
// khoá mới). Đặt nó ngay trước lệnh, cho đúng một tiến trình:
//
//   NEW_OPERATOR_SEED='<cụm từ>' node onchain/scripts/07_rotate_operator.mjs
//
// Sau khi xoay, `06_close_vault.mjs` (và mọi thao tác vận hành) phải chạy bằng ví của khoá mới.

import { Data, walletFromSeed } from "@lucid-evolution/lucid";
import {
  connect, state, saveState, buildScripts, splitVaultUtxos, explorer, awaitTx, keyHashOf, NETWORK,
} from "./common.mjs";
import { VaultDatum, VaultRedeemer } from "./schemas.mjs";

const newSeed = process.env.NEW_OPERATOR_SEED;
if (!newSeed) throw new Error("thiếu biến môi trường NEW_OPERATOR_SEED (cụm từ khôi phục của khoá mới)");
const newWallet = walletFromSeed(newSeed, { network: NETWORK });
const newKey = keyHashOf(newWallet.address);

const s = state();
const lucid = await connect();
const scripts = buildScripts({ carpPolicy: s.carpPolicy, carpName: s.carpName, seed: s.seed });

const { ledger: vault } = splitVaultUtxos(
  await lucid.utxosAt(scripts.vaultAddress), scripts.vaultNftUnit,
);
const before = Data.from(vault.datum, VaultDatum);
const walletKey = keyHashOf(await lucid.wallet().address());
if (walletKey !== before.operator_key) {
  throw new Error(
    `ví đang chọn (${walletKey}) không phải khoá vận hành hiện tại trong sổ (${before.operator_key})`,
  );
}
if (newKey === before.operator_key) {
  console.log("khoá mới trùng khoá hiện tại, bỏ qua");
  process.exit(0);
}

// Chỉ `operator_key` đổi; hai con số sổ chép nguyên.
const after = { ...before, operator_key: newKey };
console.log("khoá cũ  ", before.operator_key);
console.log("khoá mới ", newKey);
console.log("sổ       ", before.collected, "/", before.skimmed, "(giữ nguyên)");

const tx = await lucid
  .newTx()
  .collectFrom([vault], Data.to("Rotate", VaultRedeemer))
  .attach.SpendingValidator(scripts.vaultScript)
  // Giá trị y nguyên — hợp đồng so `continuing.value == own_input.output.value`.
  .pay.ToContract(scripts.vaultAddress, { kind: "inline", value: Data.to(after, VaultDatum) }, vault.assets)
  .addSignerKey(before.operator_key)
  .addSignerKey(newKey)
  .complete();

const signed = await tx.sign.withWallet().sign.withPrivateKey(newWallet.paymentKey).complete();
const txHash = await signed.submit();
console.log("tx       ", txHash);
console.log("         ", explorer(txHash));
await awaitTx(lucid, txHash, "xoay khoá:");
saveState({ rotateTx: txHash, operatorKey: newKey });
