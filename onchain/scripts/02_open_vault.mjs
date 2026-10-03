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

// Đồng CARP của instance sắp mở. Mặc định là đồng ghi ở gốc tệp trạng thái (`01` ghi tCARP
// thử). Mở kho cho một đồng CARP có sẵn trên chuỗi thì đặt `ORILIFE_FEE_CARP_POLICY` +
// `ORILIFE_FEE_CARP_NAME` (tên tài sản dạng hex), tuỳ chọn `ORILIFE_FEE_CARP_MINT_TX` (tx đúc
// đầu, chỉ để ghi nhật ký). Đồng CARP là tham số của cả ba hợp đồng, nên nó được chốt TRƯỚC khi
// chọn seed và dựng hợp đồng, và không đổi được trên một instance đang mở.
const envCarp = process.env.ORILIFE_FEE_CARP_POLICY
  ? {
      carpPolicy: process.env.ORILIFE_FEE_CARP_POLICY,
      carpName: process.env.ORILIFE_FEE_CARP_NAME ?? "",
      carpUnit: process.env.ORILIFE_FEE_CARP_POLICY + (process.env.ORILIFE_FEE_CARP_NAME ?? ""),
      mintTx: process.env.ORILIFE_FEE_CARP_MINT_TX,
    }
  : null;

const current = state();
if (!current.carpPolicy && !envCarp) {
  throw new Error("chưa có đồng CARP: chạy 01_mint_test_carp.mjs hoặc đặt ORILIFE_FEE_CARP_POLICY");
}
if (current.openTx && current.vaultNftUnit && !current.closeTx) {
  if (envCarp && envCarp.carpUnit !== current.carpUnit) {
    throw new Error("kho đang mở dùng đồng CARP khác — đóng kho cũ (06) trước khi mở cho đồng mới");
  }
  console.log("kho đã mở, bỏ qua");
  process.exit(0);
}
// Gốc tệp đang mang một instance đã mở: đã đóng thì dời vào `closed` (kèm đồng CARP nó dùng),
// chưa đóng thì `archiveClosedInstance` dừng. Chỉ có `seed` (lần trước chọn seed rồi hỏng ở
// bước gửi) thì giữ nguyên để dùng lại đúng seed đó — seed không phụ thuộc đồng CARP.
if (current.openTx) archiveClosedInstance();
const s = envCarp ? saveState(envCarp) : state();

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

const scripts = buildScripts({ carpPolicy: s.carpPolicy, carpName: s.carpName, seed });

console.log("kho tạm  ", scripts.escrowAddress);
console.log("kho phí  ", scripts.vaultAddress);
console.log("hộp thư  ", scripts.inboxAddress);
console.log("NFT sổ   ", scripts.vaultNftUnit);

// Khoá vận hành ban đầu = khoá của ví mở kho (`01` ghi vào `operatorKeyHash`). Nó nằm trong
// datum, không trong tham số kho; `Open` đòi chính khoá đó ký, nên ghi nhầm một băm không ai
// cầm khoá thì giao dịch hỏng ngay ở đây thay vì mở ra một kho không ai vận hành được.
const datum = Data.to(
  { collected: 0n, skimmed: 0n, operator_key: s.operatorKeyHash },
  VaultDatum,
);

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
  .addSignerKey(s.operatorKeyHash)
  .complete();

const signed = await tx.sign.withWallet().complete();
const txHash = await signed.submit();
console.log("tx       ", txHash);
console.log("         ", explorer(txHash));

// Ghi NGAY sau khi nộp, trước khi chờ xác nhận: `seed` đã nằm trong tệp, nên nếu bước chờ chết
// mà `openTx` chưa ghi thì lần chạy lại thấy seed đã bị tiêu, chọn seed mới và mở một instance
// THỨ HAI (đã xảy ra trên Preprod 2026-10-04: e629ec17… rồi 236ab229…).
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
await awaitTx(lucid, txHash, "mở kho:");
