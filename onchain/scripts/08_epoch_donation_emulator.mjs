// Chạy quỹ nộp kho bạc theo epoch trên Emulator của Lucid, KHÔNG chạm Preprod:
//
//   node onchain/scripts/08_epoch_donation_emulator.mjs
//
// mở quỹ → nộp epoch N (phải qua) → nộp lần hai cùng epoch N (phải bị validator bác) → sang
// epoch N+1 → nộp (phải qua) → thu hồi sớm (phải bị bác) → sang epoch N+1+idle → thu hồi (phải qua).
//
// Gọi ĐÚNG các hàm của `08_epoch_donation.mjs` (không bản sao): `connect()` trả Lucid nối Emulator,
// tệp trạng thái trỏ sang thư mục tạm, `Date.now` đi theo đồng hồ Emulator, lịch epoch tiêm qua
// biến toàn cục (epoch ngắn, để nhảy epoch không tốn hàng trăm nghìn slot).
//
// ĐO ĐƯỢC: validator chạy phase-two (cùng bộ đánh giá Lucid dùng) trên ScriptContext dịch từ
// chính giao dịch sắp nộp — gồm `treasury_donation` đọc từ thân giao dịch, khoảng hiệu lực, datum
// đi tiếp; ExUnits thật so với mức khai; thân giao dịch mang đúng trường nộp kho bạc.
// KHÔNG ĐO ĐƯỢC: sổ cái giả không áp `treasury_donation` (không có kho bạc nào được cộng) và
// không kiểm cân bằng giá trị, nên "vào = ra + phí + nộp" chỉ được kiểm ở Preprod; lịch epoch ở đây
// là lịch giả, công thức đọc lịch từ Blockfrost (`epochSchedule`) không chạy.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as CML from "@anastasia-labs/cardano-multiplatform-lib-nodejs";
import { eval_phase_two_raw } from "@lucid-evolution/uplc";
import {
  Lucid, Emulator, generateEmulatorAccount, Data, createCostModels,
  utxoToTransactionInput, utxoToTransactionOutput, SLOT_CONFIG_NETWORK, credentialToAddress,
} from "@lucid-evolution/lucid";
import { EpochDonationDatum } from "./schemas.mjs";

process.env.ORILIFE_EPOCH_DONATION_STATE_FILE = join(
  mkdtempSync(join(tmpdir(), "orilife-epoch-donation-")), "state.json",
);

const account = generateEmulatorAccount({ lovelace: 500_000_000n });
// Người lạ: nộp `reclaim` mà không phải chủ quỹ — đo luật "không cần chữ ký".
const stranger = generateEmulatorAccount({ lovelace: 100_000_000n });
// Ba UTxO chỉ-ADA: `donate` cần một ô trả tiền và một ô thế chấp; `open` lấy ô NHỎ nhất làm seed.
const emulator = new Emulator([
  account,
  stranger,
  { address: account.address, assets: { lovelace: 300_000_000n } },
  { address: account.address, assets: { lovelace: 20_000_000n } },
]);
emulator.time = Math.floor(emulator.time / 1000) * 1000;
const lucid = await Lucid(emulator, "Preprod");
lucid.selectWallet.fromSeed(account.seedPhrase);
globalThis.__ORILIFE_FEE_LUCID__ = lucid;
Date.now = () => emulator.now();

// Epoch giả: 20 phút = 1 200 slot = 60 khối. Mốc 0 = mốc 0 của Emulator.
const slotConfig = SLOT_CONFIG_NETWORK.Preprod;
const SCHEDULE = { zeroMs: slotConfig.zeroTime, lengthMs: 1_200_000 };
globalThis.__ORILIFE_EPOCH_SCHEDULE__ = SCHEDULE;
const BLOCKS_PER_EPOCH = SCHEDULE.lengthMs / 1000 / 20;

const { open, donate, reclaim, buildFund, epochAt } = await import("./08_epoch_donation.mjs");
const { readFileSync } = await import("node:fs");
const st = () => JSON.parse(readFileSync(process.env.ORILIFE_EPOCH_DONATION_STATE_FILE, "utf8"));
const saveStateRaw = (patch) => writeFileSync(
  process.env.ORILIFE_EPOCH_DONATION_STATE_FILE, JSON.stringify({ ...st(), ...patch }, null, 2) + "\n",
);

// ── Phase-two trước khi vào sổ (Emulator không tự chạy validator) ────────────
const costModels = createCostModels(emulator.protocolParameters.costModels).to_cbor_bytes();
const TAGS = ["Spend", "Mint", "Cert", "Reward", "Vote", "Propose"];
const budgets = [];
let currentStep = "";

function declaredRedeemers(witnesses) {
  const r = witnesses.redeemers();
  if (!r) return [];
  const out = [];
  const arr = r.as_arr_legacy_redeemer();
  if (arr) {
    for (let i = 0; i < arr.len(); i++) out.push({ tag: arr.get(i).tag(), index: arr.get(i).index(), ex: arr.get(i).ex_units() });
    return out;
  }
  const map = r.as_map_redeemer_key_to_redeemer_val();
  const keys = map.keys();
  for (let i = 0; i < keys.len(); i++) out.push({ tag: keys.get(i).tag(), index: keys.get(i).index(), ex: map.get(keys.get(i)).ex_units() });
  return out;
}

function phaseTwo(cbor) {
  const tx = CML.Transaction.from_cbor_hex(cbor);
  const declared = declaredRedeemers(tx.witness_set());
  if (declared.length === 0) return;
  const refs = [];
  for (const list of [tx.body().inputs(), tx.body().reference_inputs()]) {
    for (let i = 0; i < (list?.len() ?? 0); i++) {
      const key = list.get(i).transaction_id().to_hex() + list.get(i).index().toString();
      const entry = emulator.ledger[key];
      if (!entry) throw new Error(`[${currentStep}] đầu vào ${key} không có trong sổ Emulator`);
      refs.push(entry.utxo);
    }
  }
  const results = eval_phase_two_raw(
    tx.to_cbor_bytes(),
    refs.map((u) => utxoToTransactionInput(u).to_cbor_bytes()),
    refs.map((u) => utxoToTransactionOutput(u).to_cbor_bytes()),
    costModels,
    emulator.protocolParameters.maxTxExSteps,
    emulator.protocolParameters.maxTxExMem,
    BigInt(slotConfig.zeroTime),
    BigInt(slotConfig.zeroSlot),
    slotConfig.slotLength,
  );
  for (const bytes of results) {
    const r = CML.LegacyRedeemer.from_cbor_bytes(bytes);
    const used = { mem: r.ex_units().mem(), steps: r.ex_units().steps() };
    const d = declared.find((x) => x.tag === r.tag() && x.index === r.index());
    if (!d) throw new Error(`[${currentStep}] bộ đánh giá trả redeemer không có trong giao dịch`);
    if (d.ex.mem() < used.mem || d.ex.steps() < used.steps) {
      throw new Error(`[${currentStep}] ${TAGS[r.tag()]}#${r.index()} khai ${d.ex.mem()}/${d.ex.steps()} thấp hơn mức chạy thật ${used.mem}/${used.steps}`);
    }
    budgets.push({ step: currentStep, redeemer: `${TAGS[r.tag()]}#${r.index()}`, ...used });
  }
}
const submit = emulator.submitTx.bind(emulator);
emulator.submitTx = (cbor) => {
  phaseTwo(cbor); // ném lỗi ⟹ giao dịch không vào sổ
  return submit(cbor);
};

// ── Kịch bản ────────────────────────────────────────────────────────────────
const check = (ok, what) => {
  if (!ok) throw new Error(`KHÔNG ĐẠT: ${what}`);
  console.log(`  ✓ ${what}`);
};
const epochNow = () => epochAt(emulator.now(), SCHEDULE);
async function lovelaceAt(address) {
  return (await lucid.utxosAt(address)).reduce((t, u) => t + u.assets.lovelace, 0n);
}

async function fundState() {
  const fund = buildFund(st());
  const held = (await lucid.utxosAt(fund.address)).filter((u) => (u.assets[fund.unit] ?? 0n) === 1n);
  check(held.length === 1, `địa chỉ quỹ có đúng 1 ô giữ NFT (đếm ${held.length})`);
  return { lovelace: held[0].assets.lovelace, datum: Data.from(held[0].datum, EpochDonationDatum), ref: `${held[0].txHash}#${held[0].outputIndex}` };
}
/// Bước PHẢI bị từ chối: chỉ nhận lỗi đến từ VALIDATOR, không nhận lỗi bất kỳ.
async function expectRejected(label, fn, pattern) {
  currentStep = label;
  const before = await fundState();
  let error = null;
  try { await fn(); } catch (e) { error = e; }
  check(error !== null, `${label}: bị từ chối`);
  const msg = String(error?.message ?? error);
  console.log(`    lỗi: ${msg.split("\n")[0].slice(0, 220)}`);
  check(pattern.test(msg), `${label}: lỗi đến từ việc chạy validator (${pattern})`);
  const after = await fundState();
  check(after.ref === before.ref, `${label}: ô quỹ không đổi (${after.ref})`);
}
/// Bước kịch bản PHẢI tự bác trước khi dựng giao dịch: lỗi khớp `pattern`, tệp trạng thái không đổi.
async function expectScriptRefusal(label, fn, pattern) {
  currentStep = label;
  const before = readFileSync(process.env.ORILIFE_EPOCH_DONATION_STATE_FILE, "utf8");
  let error = null;
  try { await fn(); } catch (e) { error = e; }
  check(error !== null, `${label}: bị từ chối`);
  const msg = String(error?.message ?? error);
  console.log(`    lỗi: ${msg.split("\n")[0].slice(0, 220)}`);
  check(pattern.test(msg), `${label}: đúng lý do (${pattern})`);
  check(readFileSync(process.env.ORILIFE_EPOCH_DONATION_STATE_FILE, "utf8") === before, `${label}: tệp trạng thái không đổi`);
}
const nextEpochStartBlocks = () => {
  const msLeft = SCHEDULE.zeroMs + (epochNow() + 1) * SCHEDULE.lengthMs - emulator.now();
  return Math.ceil(msLeft / 20_000) + 3; // +3 khối = 60 s vào epoch mới, quá CLOCK_SLACK_MS
};

console.log("lịch epoch giả", SCHEDULE, "— epoch hiện tại", epochNow());
emulator.awaitBlock(5);

console.log("\n━━ open với per_epoch dưới min-ADA của đầu ra giữ chỗ ━━");
writeFileSync(process.env.ORILIFE_EPOCH_DONATION_STATE_FILE, "{}\n");
await expectScriptRefusal("open per_epoch 0.5 tADA", () => open({ perEpoch: 500_000n }), /min-ADA/);

currentStep = "open";
console.log("\n━━ open ━━");
await open();
console.log("\n━━ open lần hai khi quỹ cũ còn sống ━━");
await expectScriptRefusal("open đè quỹ còn sống", () => open(), /quỹ cũ còn trên chuỗi/);
const N = st().openedEpoch;
{
  const f = await fundState();
  check(f.lovelace === 10_000_000n, "quỹ 10 tADA");
  check(f.datum.last_epoch === BigInt(N - 1), `last_epoch = N − 1 = ${N - 1}`);
  check(f.datum.per_epoch === 1_000_000n && f.datum.idle_epochs === 10n, "per_epoch 1 tADA, idle_epochs 10");
}

currentStep = "donate epoch N";
console.log(`\n━━ donate (epoch N = ${epochNow()}) ━━`);
emulator.awaitBlock(1);
{
  const r = await donate();
  check(r.epoch === N, `nộp trong epoch mở quỹ N = ${N}`);
  const body = CML.Transaction.from_cbor_hex(r.cbor).body();
  check(body.donation() === 1_000_000n, `thân giao dịch mang treasury_donation = ${body.donation()}`);
  const f = await fundState();
  check(f.lovelace === 9_000_000n && f.datum.last_epoch === BigInt(N), "quỹ còn 9 tADA, last_epoch = N");
}

console.log(`\n━━ donate lần hai, cùng epoch N = ${epochNow()} ━━`);
emulator.awaitBlock(1);
await expectRejected("donate lần hai cùng epoch", () => donate({ skipLocalChecks: true }), /failed script execution|Spend\[|validator|script/i);

emulator.awaitBlock(nextEpochStartBlocks());
check(epochNow() === N + 1, `đồng hồ sang epoch N+1 = ${N + 1}`);
currentStep = "donate epoch N+1";
console.log(`\n━━ donate (epoch N+1 = ${epochNow()}) ━━`);
{
  const r = await donate();
  check(r.epoch === N + 1, "nộp trong epoch N+1");
  const f = await fundState();
  check(f.lovelace === 8_000_000n && f.datum.last_epoch === BigInt(N + 1), "quỹ còn 8 tADA, last_epoch = N+1");
}

// Từ đây ví nộp là NGƯỜI LẠ, không phải chủ quỹ: `reclaim` không ký bằng khoá `owner`.
lucid.selectWallet.fromSeed(stranger.seedPhrase);
console.log(`\n━━ reclaim sớm, người lạ nộp (epoch ${epochNow()}, mở từ epoch ${N + 1 + 10 + 1}) ━━`);
await expectRejected("reclaim sớm", () => reclaim(), /failed script execution|Spend\[|validator|script|EvaluateTransaction|eval/i);

// Đối chứng cùng bộ dựng: đủ 10 epoch nằm yên thì thu hồi được — để chắc lần bác ở trên là vì
// luật nằm yên, không vì bộ dựng `reclaim` hỏng.
for (let i = 0; i < 10; i++) emulator.awaitBlock(nextEpochStartBlocks());
check(epochNow() === N + 11, `đồng hồ sang epoch last_epoch + idle = N+1+10 = ${N + 11}`);
// Epoch biên `last_epoch + idle_epochs`: mới có 9 epoch trọn nằm yên — validator bác (dấu `>`).
console.log(`\n━━ reclaim ở epoch biên last_epoch + idle (epoch ${epochNow()}) ━━`);
await expectRejected("reclaim ở epoch biên", () => reclaim(), /failed script execution|Spend\[|validator|script|EvaluateTransaction|eval/i);
emulator.awaitBlock(nextEpochStartBlocks());
check(epochNow() === N + 12, `đồng hồ sang epoch N+1+10+1 = ${N + 12}`);
currentStep = "reclaim đủ hạn";
console.log(`\n━━ reclaim, người lạ nộp, không chữ ký chủ (epoch ${epochNow()}) ━━`);
// `owner` là băm khoá ví chủ; đích trả là địa chỉ chỉ-khoá-thanh-toán của băm đó.
const ownerAddress = credentialToAddress("Preprod", { type: "Key", hash: st().owner });
const ownerBefore = await lovelaceAt(ownerAddress);
const reclaimTx = await reclaim();
{
  const fund = buildFund(st());
  check((await lucid.utxosAt(fund.address)).length === 0, "địa chỉ quỹ trống sau thu hồi");
  const ownerAfter = await lovelaceAt(ownerAddress);
  check(ownerAfter - ownerBefore === 8_000_000n, `ví chủ quỹ nhận đúng 8 tADA (${ownerAfter - ownerBefore})`);
  const all = [...(await lucid.utxosAt(account.address)), ...(await lucid.utxosAt(stranger.address))];
  check(!all.some((u) => (u.assets[fund.unit] ?? 0n) > 0n), "NFT quỹ đã bị đốt, không nằm trong ví nào");
  const payouts = await lucid.utxosAt(ownerAddress);
  check(payouts.length === 1, `đúng một ô ở địa chỉ chủ không phần uỷ quyền (đếm ${payouts.length})`);
  check(!payouts[0].datum && !payouts[0].datumHash && !payouts[0].scriptRef, "ô trả chủ không datum, không script tham chiếu");
  check(typeof reclaimTx === "string", `tx ${reclaimTx}`);
}

// Quỹ cũ đã bị NGƯỜI LẠ thu hồi (tệp trạng thái của chủ không có `reclaimTx` nếu người lạ chạy
// từ máy khác): `open` hỏi chuỗi, không thấy NFT ⟹ cho mở quỹ mới.
console.log(`\n━━ open lại sau thu hồi, quỹ nhỏ hơn per_epoch + min-ADA (epoch ${epochNow()}) ━━`);
saveStateRaw({ reclaimTx: undefined });
emulator.awaitBlock(1);
// Kịch bản tự bác trước khi dựng giao dịch (không phải validator — validator không cấm quỹ
// thiếu tiền), nên dùng `expectScriptRefusal`: tệp trạng thái không đổi. Hai biên: quỹ < per_epoch,
// và quỹ = per_epoch + (min-ADA − 1) — nộp được lần đầu nhưng ô đi tiếp thiếu min-ADA.
await expectScriptRefusal(
  "open với quỹ < per_epoch",
  () => open({ fundLovelace: 1_500_000n, perEpoch: 2_000_000n }),
  /quỹ không đủ cho lần nộp đầu/,
);
await expectScriptRefusal(
  "open với quỹ = per_epoch + 1 tADA (dưới min-ADA ô quỹ)",
  () => open({ fundLovelace: 3_000_000n, perEpoch: 2_000_000n }),
  /quỹ không đủ cho lần nộp đầu/,
);
currentStep = "open sau thu hồi";
// Quỹ thiếu tiền vẫn dựng được qua `skipLocalChecks` để đo `donate` trên nó.
await open({ fundLovelace: 1_500_000n, perEpoch: 2_000_000n, skipLocalChecks: true });
check(st().openedEpoch === epochNow(), "mở được quỹ mới khi quỹ cũ không còn trên chuỗi");
emulator.awaitBlock(1);
await expectScriptRefusal("donate khi quỹ < per_epoch", () => donate({ skipLocalChecks: true }), /quỹ cạn/);

console.log("\nExUnits đo được (phase-two, trên giao dịch thật sắp nộp):");
for (const b of budgets) console.log(`  ${b.step.padEnd(20)} ${b.redeemer.padEnd(8)} mem ${b.mem}  steps ${b.steps}`);
console.log("\nKẾT QUẢ: mọi bước đạt.");
