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
  connect, state, saveState, buildScripts, splitVaultUtxos, sweepable, explorer, awaitTx, SKIM_BPS,
} from "./common.mjs";
import { VaultDatum, VaultRedeemer, VaultMint } from "./schemas.mjs";

const s = state();
const lucid = await connect();
const walletAddress = await lucid.wallet().address();
const scripts = buildScripts({
  carpPolicy: s.carpPolicy, carpName: s.carpName, operatorKeyHash: s.operatorKeyHash, seed: s.seed,
});

// Ô lạc có CARP ở địa chỉ kho, và ô hộp thư có CARP, chỉ vào sổ được qua `Collect` của một sổ
// CÒN SỐNG (`fee_inbox` ▸ `withdraw` đòi đầu vào giữ NFT sổ). Đóng kho khi chúng còn là bỏ lại
// CARP đó vĩnh viễn. Ô không gom được (chỉ-ADA, datum không giải được, có script) thì không
// chặn: ai cũng gửi được vào hai địa chỉ này, và chặn theo chúng là trao cho người ngoài
// quyền không cho kho đóng.
const { ledger: vault, strays } = splitVaultUtxos(
  await lucid.utxosAt(scripts.vaultAddress), scripts.vaultNftUnit,
);
const left =
  sweepable(strays, scripts.carpUnit, Infinity).picked.length +
  sweepable(await lucid.utxosAt(scripts.inboxAddress), scripts.carpUnit, Infinity).picked.length;
if (left > 0) {
  throw new Error(`còn ${left} ô CARP ở địa chỉ kho hoặc hộp thư — gom bằng 03_collect_fee.mjs trước khi đóng`);
}
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
  // NFT sổ phải bị đốt trong chính giao dịch đóng kho (`Close` đòi thế): sổ đã đóng thì
  // không còn token nào tự xưng là sổ. Hai mặt chung một script nên chỉ đính một lần.
  .mintAssets({ [scripts.vaultNftUnit]: -1n }, Data.to("Burn", VaultMint))
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
