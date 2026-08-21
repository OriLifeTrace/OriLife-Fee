// Đóng kho phí và lấy lại ADA giữ chỗ.
//
// Vì sao bước này tồn tại: mọi nhánh khác của hợp đồng đều ép
// `lovelace_of(ra) >= lovelace_of(vào)`, tức ADA giữ chỗ chỉ có đường vào. Bản trước
// không có `Close`, nên 5 tADA của mỗi instance nằm lại vĩnh viễn — và vì `operator_key`
// là tham số BIÊN DỊCH, xoay khoá vận hành là dựng instance mới, mỗi lần xoay là bỏ lại
// thêm một khoản. Đóng được kho là điều kiện để xoay khoá mà không bỏ của.
//
// Hợp đồng chỉ cho đóng khi nghĩa vụ đã trả HẾT: `ceil(collected × bps / 10000) == skimmed`.
// Không có câu đó thì `Close` là cửa thoát cho toàn bộ cơ chế.

import { Data } from "@lucid-evolution/lucid";
import {
  connect, state, saveState, buildScripts, explorer, awaitTx, SKIM_BPS,
} from "./common.mjs";
import { VaultDatum, VaultRedeemer } from "./schemas.mjs";

const s = state();
const lucid = await connect();
const walletAddress = await lucid.wallet().address();
const scripts = buildScripts({
  carpPolicy: s.carpPolicy, carpName: s.carpName, operatorKeyHash: s.operatorKeyHash,
});

const utxos = await lucid.utxosAt(scripts.vaultAddress);
if (utxos.length !== 1) throw new Error(`kho phải có đúng 1 UTxO, đang thấy ${utxos.length}`);
const vault = utxos[0];
const ledger = Data.from(vault.datum, VaultDatum);

// Tính lại đúng công thức hợp đồng dùng, để dừng ở đây thay vì dừng ở nút mạng.
const obligation = (ledger.collected * BigInt(SKIM_BPS) + 9_999n) / 10_000n;
console.log("sổ       ", ledger.collected, "/", ledger.skimmed);
console.log("nghĩa vụ ", obligation, "(làm tròn lên)");
if (obligation !== ledger.skimmed) {
  throw new Error(
    `chưa trả hết nghĩa vụ: cần skimmed = ${obligation}, đang là ${ledger.skimmed}. ` +
    `Chạy 04_skim.mjs rồi 05_swap_and_donate.mjs trước.`,
  );
}

const held = vault.assets[scripts.carpUnit] ?? 0n;
console.log("thu về   ", vault.assets.lovelace, "lovelace +", held, "đơn vị tCARP");

const tx = await lucid
  .newTx()
  .collectFrom([vault], Data.to("Close", VaultRedeemer))
  .attach.SpendingValidator(scripts.vaultScript)
  // Chữ ký vận hành. Ví đang dùng chính là khoá vận hành (`operatorKeyHash` suy từ nó),
  // nhưng phải khai tường minh: bộ dựng không tự thêm khoá vào `extra_signatories`.
  .addSignerKey(s.operatorKeyHash)
  .complete();

const signed = await tx.sign.withWallet().complete();
const txHash = await signed.submit();
console.log("tx       ", txHash);
console.log("         ", explorer(txHash));
await awaitTx(lucid, txHash, "đóng kho:");
saveState({ closeTx: txHash, closedAt: walletAddress });
