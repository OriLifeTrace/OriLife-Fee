// Nộp phí vào kho. Đây là lượt chi tiêu ĐẦU TIÊN qua hợp đồng, nên nó cũng là lần đầu
// luật được máy kiểm tra thật chứ không phải trong bài kiểm.

import { Data } from "@lucid-evolution/lucid";
import { connect, state, saveState, buildScripts, explorer, awaitTx, CARP_SCALE } from "./common.mjs";
import { VaultDatum, VaultRedeemer } from "./schemas.mjs";

const FEE_CARP = 1_000n;

const s = state();
const lucid = await connect();
const scripts = buildScripts({
  carpPolicy: s.carpPolicy, carpName: s.carpName, operatorKeyHash: s.operatorKeyHash,
});

const utxos = await lucid.utxosAt(scripts.vaultAddress);
if (utxos.length !== 1) throw new Error(`kho phải có đúng 1 UTxO, đang thấy ${utxos.length}`);
const vault = utxos[0];
const before = Data.from(vault.datum, VaultDatum);

const amount = FEE_CARP * CARP_SCALE;
const after = { collected: before.collected + amount, skimmed: before.skimmed };

console.log("sổ trước ", before.collected, "/", before.skimmed);
console.log("nộp      ", FEE_CARP, "tCARP");
console.log("sổ sau   ", after.collected, "/", after.skimmed);

const tx = await lucid
  .newTx()
  .collectFrom([vault], Data.to({ Collect: { amount } }, VaultRedeemer))
  .attach.SpendingValidator(scripts.vaultScript)
  .pay.ToContract(
    scripts.vaultAddress,
    { kind: "inline", value: Data.to(after, VaultDatum) },
    { lovelace: vault.assets.lovelace, [scripts.carpUnit]: (vault.assets[scripts.carpUnit] ?? 0n) + amount },
  )
  .complete();

const signed = await tx.sign.withWallet().complete();
const txHash = await signed.submit();
console.log("tx       ", txHash);
console.log("         ", explorer(txHash));
await awaitTx(lucid, txHash, "nộp phí:");
saveState({ collectTx: txHash, collected: after.collected.toString() });
