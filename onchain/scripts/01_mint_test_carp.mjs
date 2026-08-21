// Đúc CARP thử trên Preprod.
//
// CARP thật chưa phát hành (nhà MAGIC vẫn ghi "chờ CARP" trong bản khai triển khai),
// nên toàn tuyến phí không thể thử bằng đồng thật. Đây là đồng THỬ, chính sách đúc là
// một chữ ký đơn — không giả vờ đó là CARP thật, và tên `tCARP` nói thẳng điều đó.

import {
  connect, saveState, state, explorer, awaitTx, keyHashOf,
  TEST_CARP_NAME, CARP_SCALE,
} from "./common.mjs";
import { fromText, mintingPolicyToId, scriptFromNative } from "@lucid-evolution/lucid";

const SUPPLY_CARP = 1_000_000n;

const lucid = await connect();
const address = await lucid.wallet().address();
const keyHash = keyHashOf(address);

const policy = scriptFromNative({ type: "sig", keyHash });
const policyId = mintingPolicyToId(policy);
const unit = policyId + fromText(TEST_CARP_NAME);
const quantity = SUPPLY_CARP * CARP_SCALE;

console.log("ví      ", address);
console.log("policy  ", policyId);
console.log("đúc     ", SUPPLY_CARP, "tCARP =", quantity, "đơn vị nhỏ nhất");

if (state().carpPolicy === policyId) {
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
await awaitTx(lucid, txHash, "đúc tCARP:");

saveState({
  network: "Preprod",
  wallet: address,
  operatorKeyHash: keyHash,
  carpPolicy: policyId,
  carpName: TEST_CARP_NAME,
  carpUnit: unit,
  mintTx: txHash,
});
