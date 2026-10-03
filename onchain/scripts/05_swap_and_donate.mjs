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
import {
  utxoToCore, assetsToValue, createCostModels, unixTimeToSlot, slotToUnixTime,
} from "@lucid-evolution/utils";
import { Data } from "@lucid-evolution/lucid";
import {
  connect, state, saveState, buildScripts, explorer, awaitTx, requiredDonation,
  NETWORK, CARP_SCALE,
} from "./common.mjs";
import { EscrowDatum } from "./schemas.mjs";

/// Khai rộng tay. Đo lại 2026-09-27 bằng `aiken check` (trường `execution_units` của từng
/// bài): bài tốn nhất của cả hai validator dưới 120 M bước / 350 K bộ nhớ. Số đúng tại thời
/// điểm chạy nằm ở output của lệnh đó, không chép lại đây; mức khai dưới đây dư ~7 lần.
const EX_MEM = 2_000_000n;
const EX_STEPS = 900_000_000n;

const s = state();
const lucid = await connect();
const walletAddress = await lucid.wallet().address();
const scripts = buildScripts({
  carpPolicy: s.carpPolicy, carpName: s.carpName, seed: s.seed,
});

// Ai cũng `Skim` được, nên địa chỉ kho tạm có thể giữ nhiều lô cùng lúc. Đòi "đúng 1 ô" thì
// một lần trích 1 đơn vị của người ngoài là dừng cả tuyến. Chọn lô của ĐÚNG instance kho phí
// này, NHIỀU CARP nhất, hoà thì mở phiên sớm nhất; ô không đọc được datum thì bỏ qua. Không xếp
// theo `listed_at` trước: ai cũng gửi được một lô giả mang băm kho thật với `listed_at = 0` và
// 1 đơn vị CARP, và lô đó sẽ luôn đứng đầu, mỗi lượt `05` tốn trọn phí cho 1 đơn vị.
const atEscrow = await lucid.utxosAt(scripts.escrowAddress);
const lots = atEscrow.flatMap((u) => {
  try {
    const d = Data.from(u.datum, EscrowDatum);
    const held = u.assets[scripts.carpUnit] ?? 0n;
    return d.vault === scripts.vaultHash && d.carp === held && held > 0n ? [{ u, d }] : [];
  } catch {
    return [];
  }
});
if (lots.length === 0) throw new Error("kho tạm không có lô nào của instance kho phí này");
const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
lots.sort((a, b) => cmp(b.d.carp, a.d.carp) || cmp(a.d.listed_at, b.d.listed_at));
const { u: escrow, d: escrowDatum } = lots[0];
console.log("số lô       ", lots.length, "— chọn lô nhiều CARP nhất;",
  atEscrow.length - lots.length, "ô khác ở địa chỉ kho tạm bị bỏ qua");
const held = escrow.assets[scripts.carpUnit] ?? 0n;
if (escrowDatum.carp !== held) throw new Error(`sổ kho tạm khai ${escrowDatum.carp} nhưng giữ ${held}`);

// Giá đấu giảm dần tính tại CẬN DƯỚI khoảng hiệu lực (`donation_escrow.ak`). Cận dưới là
// một slot; hợp đồng thấy thời điểm của slot đó, nên tính giá đúng tại thời điểm ấy chứ
// không tại đồng hồ máy. Lùi 60 giây để không bị từ chối vì đồng hồ chạy nhanh hơn mạng —
// cận dưới sớm hơn thì giá cao hơn một chút, chiều có lợi cho kho bạc.
const startSlot = unixTimeToSlot(NETWORK, Date.now() - 60_000);
const priceAt = slotToUnixTime(NETWORK, startSlot);

// Nộp hết một lượt: toàn bộ CARP rời kho tạm.
const releasedCarp = held;
const requiredLovelace = requiredDonation(releasedCarp, escrowDatum.listed_at, priceAt);

console.log("kho tạm giữ ", releasedCarp, "=", Number(releasedCarp / CARP_SCALE), "tCARP");
console.log("mở phiên    ", new Date(Number(escrowDatum.listed_at)).toISOString());
console.log("tính giá lúc", new Date(priceAt).toISOString());
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
// Cận dưới hữu hạn là điều kiện của hợp đồng (không có thì `Donate` hỏng), và nó là mốc
// tính giá ở trên — hai chỗ phải cùng một slot.
txb.set_validity_start_interval(BigInt(startSlot));

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
// Phí bộ dựng tính ra ĐÃ gồm chi phí thực thi khai ở trên (đo trên Emulator: phí 432 471 =
// 44 × kích thước + 155 381 + giá ExUnits). Gỡ ô giữ chỗ chỉ làm thân giao dịch nhỏ đi, nên phí
// cũ vẫn đủ; không bù thêm.
const placeholderLovelace = requiredLovelace;
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

const body = CML.TransactionBody.new(oldBody.inputs(), keptOuts, oldBody.fee());
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
