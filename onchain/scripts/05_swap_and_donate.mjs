// Đổi CARP lấy ADA rồi nộp kho bạc Cardano, TRONG CÙNG MỘT GIAO DỊCH.
//
// Đây là mắt xích chịu lực của cả cơ chế. Hợp đồng kho tạm chỉ mở khoá khi thân giao
// dịch có trường `treasury_donation` đủ sàn — nên bước này không phải một thói quen vận
// hành, nó là điều kiện chi tiêu.
//
// Vì sao phải dựng giao dịch bằng tay thay vì để bộ dựng lo:
//   Bộ dựng chạy thử hợp đồng TRƯỚC khi trả về giao dịch, mà lúc đó trường nộp kho bạc
//   chưa có, nên hợp đồng từ chối và bộ dựng ném lỗi. Vòng lặp không thoát được: muốn
//   qua bước chạy thử thì phải có khoản nộp, muốn đặt khoản nộp thì phải qua bước chạy
//   thử. Nên ở đây lắp thẳng bằng thư viện tầng dưới, khai chi phí thực thi RỘNG TAY và
//   để nút mạng tự kiểm lại — nút chỉ từ chối khi chi phí thật VƯỢT mức khai, còn khai
//   dư thì chỉ tốn thêm phí.
//
// "Sàn giao dịch" ở bản thử này là một địa chỉ ví thứ hai đóng vai bên mua CARP. Hợp
// đồng không quan tâm CARP đi đâu — nó chỉ ràng buộc kho bạc phải nhận đủ. Ranh giới đó
// là cố ý: buộc một sàn cụ thể vào mã là buộc luôn cả rủi ro của sàn đó.

import * as CML from "@anastasia-labs/cardano-multiplatform-lib-nodejs";
import { utxoToCore, assetsToValue, createCostModels } from "@lucid-evolution/utils";
import { Data } from "@lucid-evolution/lucid";
import {
  connect, state, saveState, buildScripts, explorer, awaitTx,
  MIN_LOVELACE_PER_CARP, CARP_SCALE,
} from "./common.mjs";
import { EscrowDatum } from "./schemas.mjs";

/// Khai rộng tay. Bài kiểm cục bộ đo lượt tốn nhất khoảng 75 M bước, 300 K bộ nhớ.
const EX_MEM = 2_000_000n;
const EX_STEPS = 900_000_000n;

const s = state();
const lucid = await connect();
const walletAddress = await lucid.wallet().address();
const scripts = buildScripts({
  carpPolicy: s.carpPolicy, carpName: s.carpName, operatorKeyHash: s.operatorKeyHash,
});

const escrowUtxos = await lucid.utxosAt(scripts.escrowAddress);
if (escrowUtxos.length !== 1) throw new Error(`kho tạm phải có đúng 1 UTxO, đang thấy ${escrowUtxos.length}`);
const escrow = escrowUtxos[0];
const held = escrow.assets[scripts.carpUnit] ?? 0n;
const declared = Data.from(escrow.datum, EscrowDatum).carp;
if (declared !== held) throw new Error(`sổ kho tạm khai ${declared} nhưng giữ ${held}`);

// Nộp hết một lượt: toàn bộ CARP rời kho tạm.
const releasedCarp = held;
const requiredLovelace =
  (releasedCarp * BigInt(MIN_LOVELACE_PER_CARP) + CARP_SCALE - 1n) / CARP_SCALE;

console.log("kho tạm giữ ", releasedCarp, "=", Number(releasedCarp / CARP_SCALE), "tCARP");
console.log("sàn tỉ giá  ", MIN_LOVELACE_PER_CARP, "lovelace mỗi CARP");
console.log("phải nộp    ", requiredLovelace, "lovelace vào kho bạc Cardano");

const walletUtxos = await lucid.wallet().getUtxos();
const funding = walletUtxos
  .filter((u) => Object.keys(u.assets).length === 1 && u.assets.lovelace > 10_000_000n)
  .sort((a, b) => Number(b.assets.lovelace - a.assets.lovelace));
if (funding.length < 2) throw new Error("cần ít nhất 2 UTxO chỉ-ADA để trả phí và đặt cọc");
const payer = funding[0];
const collateral = funding[1];

// Bộ dựng của thư viện tầng trên đã nạp sẵn đúng tham số mạng — mượn lại nó thay vì
// khai tay từng hằng số phí, vì khai tay là chỗ lệch âm thầm với mạng thật.
const txb = lucid.newTx().rawConfig().txBuilder;

const redeemer = CML.PlutusData.new_constr_plutus_data(
  CML.ConstrPlutusData.new(0n, CML.PlutusDataList.new()),
);
const scriptWitness = CML.PlutusScriptWitness.new_script(
  CML.PlutusScript.from_v3(CML.PlutusV3Script.from_cbor_hex(scripts.escrowScript.script)),
);
const partial = CML.PartialPlutusWitness.new(scriptWitness, redeemer);

txb.add_input(
  CML.SingleInputBuilder.from_transaction_unspent_output(utxoToCore(escrow))
    .plutus_script_inline_datum(partial, CML.Ed25519KeyHashList.new()),
);
// `add_input` chứ không phải `add_utxo`: `add_utxo` chỉ đưa vào rổ để bộ chọn cân
// nhắc, còn ở đây cần chắc chắn có tiền trả phí và trả khoản nộp kho bạc.
for (const u of [payer]) {
  txb.add_input(CML.SingleInputBuilder.from_transaction_unspent_output(utxoToCore(u)).payment_key());
}
txb.add_collateral(
  CML.SingleInputBuilder.from_transaction_unspent_output(utxoToCore(collateral)).payment_key(),
);

// Chỉ số redeemer chi tiêu KHÔNG phải thứ tự nạp vào, mà là vị trí của đầu vào sau khi
// giao dịch SẮP XẾP đầu vào theo (mã giao dịch, số thứ tự). Đưa nhầm số thì thư viện
// tầng dưới không báo lỗi tử tế — nó nổ ở tầng wasm và làm hỏng luôn bộ dựng, nên phải
// tính đúng ngay từ đầu chứ không dò.
const ordered = [escrow, payer]
  .map((u) => ({ key: u.txHash + String(u.outputIndex).padStart(6, "0"), u }))
  .sort((a, b) => (a.key < b.key ? -1 : 1));
const spendIndex = BigInt(ordered.findIndex((o) => o.u === escrow));
txb.set_exunits(
  CML.RedeemerWitnessKey.new(CML.RedeemerTag.Spend, spendIndex),
  CML.ExUnits.new(EX_MEM, EX_STEPS),
);
const buyer = CML.Address.from_bech32(walletAddress);

// Bên mua CARP nhận toàn bộ CARP.
txb.add_output(
  CML.TransactionOutputBuilder.new()
    .with_address(buyer)
    .next()
    .with_value(assetsToValue({ lovelace: 2_000_000n, [scripts.carpUnit]: releasedCarp }))
    .build(),
);

// Ô GIỮ CHỖ cho khoản nộp kho bạc: dựng như một đầu ra bình thường để bộ dựng cân đối
// đủ tiền, rồi ngay sau đây gỡ nó ra và chuyển đúng ngần ấy sang trường nộp kho bạc.
// Cân bằng vẫn đúng từng lovelace: `vào = ra + phí + nộp`.
// Ô giữ chỗ gánh HAI khoản: phần nộp kho bạc, và phần phí thêm cho việc chạy hợp đồng
// (bộ dựng tính phí khi chi phí thực thi còn bằng 0, nên phải bù tay sau).
const FEE_SLACK = 1_500_000n;
const placeholderLovelace = requiredLovelace + FEE_SLACK;
txb.add_output(
  CML.TransactionOutputBuilder.new()
    .with_address(buyer)
    .next()
    .with_value(assetsToValue({ lovelace: placeholderLovelace }))
    .build(),
);

const signedBuilder = txb.build(CML.ChangeSelectionAlgo.Default, buyer);
const built = signedBuilder.build_unchecked();

// ── Gỡ ô giữ chỗ, đặt khoản nộp kho bạc ─────────────────────────────────────
const oldBody = built.body();
const oldOuts = oldBody.outputs();
const keptOuts = CML.TransactionOutputList.new();
let removed = false;
for (let i = 0; i < oldOuts.len(); i++) {
  const out = oldOuts.get(i);
  const isPlaceholder =
    !removed &&
    out.amount().coin() === placeholderLovelace &&
    (out.amount().multi_asset()?.policy_count() ?? 0) === 0;
  if (isPlaceholder) { removed = true; continue; }
  keptOuts.add(out);
}
if (!removed) throw new Error("không tìm thấy ô giữ chỗ để gỡ — dừng, đừng đoán");

const body = CML.TransactionBody.new(oldBody.inputs(), keptOuts, oldBody.fee() + FEE_SLACK);
const carry = [
  ["set_ttl", "ttl"], ["set_validity_interval_start", "validity_interval_start"],
  ["set_network_id", "network_id"], ["set_script_data_hash", "script_data_hash"],
  ["set_collateral_inputs", "collateral_inputs"], ["set_collateral_return", "collateral_return"],
  ["set_total_collateral", "total_collateral"], ["set_reference_inputs", "reference_inputs"],
  ["set_required_signers", "required_signers"],
];
for (const [setter, getter] of carry) {
  const v = oldBody[getter]?.();
  if (v !== undefined && v !== null) body[setter](v);
}
body.set_donation(requiredLovelace);

// Chi phí thực thi đã khai TRƯỚC khi dựng, nên băm dữ liệu hợp đồng mà bộ dựng tính ra
// đã đúng — chỉ chép nguyên sang thân mới (vòng `carry` ở trên đã làm việc đó). Gỡ một
// đầu ra và thêm trường nộp kho bạc KHÔNG đụng tới băm ấy: nó chỉ phủ redeemer, datum
// và bảng chi phí.
const witnesses = built.witness_set();

const tx = CML.Transaction.new(body, witnesses, true, built.auxiliary_data());
const cbor = tx.to_cbor_hex();

console.log("nộp kho bạc ", requiredLovelace, "lovelace");
console.log("kích thước  ", cbor.length / 2, "byte");

const signed = await lucid.fromTx(cbor).sign.withWallet().complete();
const txHash = await signed.submit();
console.log("tx          ", txHash);
console.log("            ", explorer(txHash));
await awaitTx(lucid, txHash, "đổi + nộp:");
saveState({ donateTx: txHash, donatedLovelace: requiredLovelace.toString() });
