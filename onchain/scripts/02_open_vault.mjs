// Mở kho phí: tạo UTxO đầu tiên ở địa chỉ hợp đồng, sổ bắt đầu từ 0/0.

import { Data } from "@lucid-evolution/lucid";
import { connect, state, saveState, buildScripts, explorer, awaitTx } from "./common.mjs";
import { VaultDatum } from "./schemas.mjs";

const s = state();
if (!s.carpPolicy) throw new Error("chạy 01_mint_test_carp.mjs trước");

const lucid = await connect();
const scripts = buildScripts({
  carpPolicy: s.carpPolicy,
  carpName: s.carpName,
  operatorKeyHash: s.operatorKeyHash,
});

console.log("kho tạm  ", scripts.escrowAddress);
console.log("kho phí  ", scripts.vaultAddress);

if (s.vaultAddress === scripts.vaultAddress && s.openTx) {
  console.log("kho đã mở, bỏ qua");
  process.exit(0);
}

const datum = Data.to({ collected: 0n, skimmed: 0n }, VaultDatum);

const tx = await lucid
  .newTx()
  .pay.ToContract(scripts.vaultAddress, { kind: "inline", value: datum }, { lovelace: 5_000_000n })
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
  openTx: txHash,
});
