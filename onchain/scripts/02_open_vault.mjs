// Mở kho phí: đúc NFT sổ và tạo ô sổ đầu tiên ở địa chỉ hợp đồng, sổ bắt đầu từ 0/0.
//
// NFT sổ là thứ định danh kho (`fee_vault.ak` ▸ mặt `mint`, nhánh `Open`). Không có nó thì
// một UTxO bất kỳ ở địa chỉ kho mang datum tự đặt trông y hệt sổ. Nó đúc-một-lần nhờ `seed`:
// hợp đồng nhận `seed` làm tham số và `Open` đòi giao dịch tiêu đúng UTxO đó, nên `seed`
// phải được chọn và GHI vào tệp trạng thái trước khi dựng hợp đồng.

import { Data } from "@lucid-evolution/lucid";
import {
  connect, state, saveState, archiveClosedInstance, buildScripts, explorer, awaitTx,
} from "./common.mjs";
import { VaultDatum, VaultMint } from "./schemas.mjs";

const current = state();
if (!current.carpPolicy) throw new Error("chạy 01_mint_test_carp.mjs trước");
if (current.openTx && current.vaultNftUnit && !current.closeTx) {
  console.log("kho đã mở, bỏ qua");
  process.exit(0);
}
// Gốc tệp đang mang một instance đã mở: đã đóng thì dời vào `closed`, chưa đóng thì
// `archiveClosedInstance` dừng. Chỉ có `seed` (lần trước chọn seed rồi hỏng ở bước gửi) thì
// giữ nguyên để dùng lại đúng seed đó.
const s = current.openTx ? archiveClosedInstance() : current;

const lucid = await connect();

// Chọn seed một lần rồi giữ: chạy lại kịch bản sau khi đã ghi seed mà seed chưa bị tiêu thì
// dùng lại đúng UTxO đó, để băm hợp đồng không đổi giữa hai lần chạy.
let seed = s.seed;
const walletUtxos = await lucid.wallet().getUtxos();
let seedUtxo = seed &&
  walletUtxos.find((u) => u.txHash === seed.txHash && u.outputIndex === seed.outputIndex);
if (!seedUtxo) {
  seedUtxo = walletUtxos.find(
    (u) => Object.keys(u.assets).length === 1 && u.assets.lovelace > 10_000_000n,
  );
  if (!seedUtxo) throw new Error("ví cần một UTxO chỉ-ADA trên 10 tADA để làm seed");
  seed = { txHash: seedUtxo.txHash, outputIndex: seedUtxo.outputIndex };
  saveState({ seed });
}

const scripts = buildScripts({
  carpPolicy: s.carpPolicy,
  carpName: s.carpName,
  operatorKeyHash: s.operatorKeyHash,
  seed,
});

console.log("kho tạm  ", scripts.escrowAddress);
console.log("kho phí  ", scripts.vaultAddress);
console.log("hộp thư  ", scripts.inboxAddress);
console.log("NFT sổ   ", scripts.vaultNftUnit);

const datum = Data.to({ collected: 0n, skimmed: 0n }, VaultDatum);

const tx = await lucid
  .newTx()
  .collectFrom([seedUtxo])
  .mintAssets({ [scripts.vaultNftUnit]: 1n }, Data.to("Open", VaultMint))
  .attach.MintingPolicy(scripts.vaultScript)
  // Đăng ký stake credential của hộp thư phí (cọc theo tham số mạng). Thiếu bước này thì
  // lượt gom không rút 0 lovelace được, và mọi ô hộp thư nằm yên. Mặt `publish` của
  // `fee_inbox` chỉ cho đăng ký — huỷ đăng ký và uỷ quyền đều bị từ chối.
  .register.Stake(scripts.inboxRewardAddress, Data.void())
  .attach.CertificateValidator(scripts.inboxScript)
  .pay.ToContract(
    scripts.vaultAddress,
    { kind: "inline", value: datum },
    { lovelace: 5_000_000n, [scripts.vaultNftUnit]: 1n },
  )
  .complete();

const signed = await tx.sign.withWallet().complete();
const txHash = await signed.submit();
console.log("tx       ", txHash);
console.log("         ", explorer(txHash));
await awaitTx(lucid, txHash, "mở kho:");

saveState({
  escrowAddress: scripts.escrowAddress,
  escrowHash: scripts.escrowHash,
  vaultAddress: scripts.vaultAddress,
  vaultHash: scripts.vaultHash,
  vaultNftUnit: scripts.vaultNftUnit,
  inboxAddress: scripts.inboxAddress,
  inboxHash: scripts.inboxHash,
  inboxRewardAddress: scripts.inboxRewardAddress,
  openTx: txHash,
});
