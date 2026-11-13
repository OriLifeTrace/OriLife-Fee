// Đúc RING thử trên Preprod.
//
// RING thật chưa phát hành (nhà MAGIC vẫn ghi "chờ RING" trong bản khai triển khai),
// nên toàn tuyến phí không thể thử bằng đồng thật. Đây là đồng THỬ, chính sách đúc là
// một chữ ký đơn — không giả vờ đó là RING thật, và tên `tRING` nói thẳng điều đó.

import {
  connect, saveState, state, explorer, awaitTx, keyHashOf,
  TEST_RING_NAME, RING_SCALE,
} from "./common.mjs";
import { fromText, mintingPolicyToId, scriptFromNative } from "@lucid-evolution/lucid";

const SUPPLY_RING = 1_000_000n;

const lucid = await connect();
const address = await lucid.wallet().address();
const keyHash = keyHashOf(address);

const policy = scriptFromNative({ type: "sig", keyHash });
const policyId = mintingPolicyToId(policy);
const unit = policyId + fromText(TEST_RING_NAME);
const quantity = SUPPLY_RING * RING_SCALE;

console.log("ví      ", address);
console.log("policy  ", policyId);
console.log("đúc     ", SUPPLY_RING, "tRING =", quantity, "đơn vị nhỏ nhất");

if (state().ringPolicy === policyId) {
  console.log("đã đúc trước đó, bỏ qua");
  process.exit(0);
}

const tx = await lucid
  .newTx()
  .mintAssets({ [unit]: quantity })
  .attach.MintingPolicy(policy)
  .addSigner(address)
  .complete();

const signed = await tx.sign.withWallet().complete();
const txHash = await signed.submit();

console.log("tx      ", txHash);
console.log("        ", explorer(txHash));
await awaitTx(lucid, txHash, "đúc tRING:");

saveState({
  network: "Preprod",
  wallet: address,
  operatorKeyHash: keyHash,
  ringPolicy: policyId,
  // Tên tài sản ghi dạng hex — `buildScripts` nhận đúng bytes trên chuỗi.
  ringName: fromText(TEST_RING_NAME),
  ringUnit: unit,
  mintTx: txHash,
});
