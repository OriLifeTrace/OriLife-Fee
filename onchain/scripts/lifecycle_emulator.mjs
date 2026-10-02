// Chạy trọn vòng đời kho phí 01 → 06 trên Emulator, KHÔNG chạm Preprod.
//
//   node onchain/scripts/lifecycle_emulator.mjs
//
// Chạy đúng các kịch bản thật (không bản sao): `connect()` trả Lucid nối Emulator mà tệp này
// cài sẵn, tệp trạng thái trỏ sang thư mục tạm, `Date.now` đi theo đồng hồ Emulator.
//
// Emulator của Lucid KHÔNG chạy validator lúc nhận giao dịch — nó chỉ kiểm chữ ký, đầu vào,
// chứng chỉ. Bộ dựng chạy thử validator lúc `.complete()`, nhưng `05` dựng tay nên không đi
// qua bước đó. Vì vậy mọi giao dịch có redeemer đều được chạy lại phase-two ở đây, đúng bộ
// đánh giá mà Lucid dùng, trên ScriptContext dịch từ chính giao dịch sắp nộp; validator từ
// chối thì giao dịch không vào sổ và bộ chạy dừng.
//
// Emulator cũng KHÔNG kiểm datum của đầu vào ở phase-1: nó nhận cả giao dịch tiêu một ô mang băm
// datum không ai có tiền ảnh, trong khi sổ cái thật bác ngay. Bộ chạy kiểm bù điều đó (`phaseOne`).
//
// Còn không thay được Preprod ở: cân bằng giá trị, trường `treasury_donation` ở tầng sổ cái
// (validator thấy trường đó, sổ cái giả thì không), trần kích thước reference script.

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as CML from "@anastasia-labs/cardano-multiplatform-lib-nodejs";
import { eval_phase_two_raw } from "@lucid-evolution/uplc";
import {
  Lucid, Emulator, generateEmulatorAccount, Data, createCostModels,
  utxoToTransactionInput, utxoToTransactionOutput, SLOT_CONFIG_NETWORK,
} from "@lucid-evolution/lucid";

const stateDir = mkdtempSync(join(tmpdir(), "orilife-fee-emulator-"));
process.env.ORILIFE_FEE_STATE_FILE = join(stateDir, "state.json");

const account = generateEmulatorAccount({ lovelace: 2_000_000_000n });
// Ba UTxO chỉ-ADA: `05` cần một ô trả tiền và một ô thế chấp riêng.
const emulator = new Emulator([
  account,
  { address: account.address, assets: { lovelace: 500_000_000n } },
  { address: account.address, assets: { lovelace: 500_000_000n } },
]);
// Mốc 0 tròn giây như Preprod: kịch bản `04` dựa vào việc mốc tròn giây đi lên chuỗi rồi
// quay về hợp đồng đúng nguyên giá trị.
emulator.time = Math.floor(emulator.time / 1000) * 1000;
emulator.awaitBlock(10);

// Lucid nối Emulator ghi đè cấu hình slot của tên mạng được truyền vào, nên các kịch bản
// vẫn đổi thời gian ↔ slot bằng `"Preprod"` mà ra đúng slot của Emulator.
const lucid = await Lucid(emulator, "Preprod");
lucid.selectWallet.fromSeed(account.seedPhrase);
globalThis.__ORILIFE_FEE_LUCID__ = lucid;
Date.now = () => emulator.now();

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
    for (let i = 0; i < arr.len(); i++) {
      const x = arr.get(i);
      out.push({ tag: x.tag(), index: x.index(), ex: x.ex_units() });
    }
    return out;
  }
  const map = r.as_map_redeemer_key_to_redeemer_val();
  const keys = map.keys();
  for (let i = 0; i < keys.len(); i++) {
    const k = keys.get(i);
    out.push({ tag: k.tag(), index: k.index(), ex: map.get(k).ex_units() });
  }
  return out;
}

function inputUtxos(body) {
  const out = [];
  // Cờ `spent` gắn theo danh sách, KHÔNG so `list === body.inputs()`: mỗi lần gọi, CML trả một
  // đối tượng bọc MỚI, nên phép so đó luôn sai và mọi đầu vào thành "chỉ đọc" — `phaseOne` khi
  // ấy không kiểm gì mà vẫn im lặng (đã xảy ra, bắt được bằng đột biến bỏ bộ lọc datum).
  for (const [list, spent] of [[body.inputs(), true], [body.reference_inputs(), false]]) {
    for (let i = 0; i < (list?.len() ?? 0); i++) {
      const input = list.get(i);
      const key = input.transaction_id().to_hex() + input.index().toString();
      const entry = emulator.ledger[key];
      if (!entry) throw new Error(`[${currentStep}] đầu vào ${key} không có trong sổ Emulator`);
      out.push({ utxo: entry.utxo, spent });
    }
  }
  return out;
}

/// Phần phase-1 mà Emulator bỏ qua: mọi đầu vào bị tiêu mang băm datum (không inline) phải có
/// đúng datum đó trong witness set.
function phaseOne(cbor) {
  const tx = CML.Transaction.from_cbor_hex(cbor);
  const datums = tx.witness_set().plutus_datums();
  const have = new Set();
  for (let i = 0; i < (datums?.len() ?? 0); i++) have.add(CML.hash_plutus_data(datums.get(i)).to_hex());
  for (const { utxo, spent } of inputUtxos(tx.body())) {
    if (spent && utxo.datumHash && !utxo.datum && !have.has(utxo.datumHash)) {
      throw new Error(`[${currentStep}] phase-1: tiêu ô ${utxo.txHash}#${utxo.outputIndex} mà thiếu datum ${utxo.datumHash}`);
    }
  }
}

function phaseTwo(cbor) {
  const tx = CML.Transaction.from_cbor_hex(cbor);
  const declared = declaredRedeemers(tx.witness_set());
  if (declared.length === 0) return;
  const refs = inputUtxos(tx.body()).map((x) => x.utxo);
  const slot = SLOT_CONFIG_NETWORK.Preprod;
  const results = eval_phase_two_raw(
    tx.to_cbor_bytes(),
    refs.map((u) => utxoToTransactionInput(u).to_cbor_bytes()),
    refs.map((u) => utxoToTransactionOutput(u).to_cbor_bytes()),
    costModels,
    emulator.protocolParameters.maxTxExSteps,
    emulator.protocolParameters.maxTxExMem,
    BigInt(slot.zeroTime),
    BigInt(slot.zeroSlot),
    slot.slotLength,
  );
  for (const bytes of results) {
    const r = CML.LegacyRedeemer.from_cbor_bytes(bytes);
    const used = { mem: r.ex_units().mem(), steps: r.ex_units().steps() };
    const d = declared.find((x) => x.tag === r.tag() && x.index === r.index());
    if (!d) throw new Error(`[${currentStep}] bộ đánh giá trả redeemer không có trong giao dịch`);
    if (d.ex.mem() < used.mem || d.ex.steps() < used.steps) {
      throw new Error(
        `[${currentStep}] ${TAGS[r.tag()]}#${r.index()} khai ${d.ex.mem()}/${d.ex.steps()} ` +
        `thấp hơn mức chạy thật ${used.mem}/${used.steps}`,
      );
    }
    budgets.push({ step: currentStep, redeemer: `${TAGS[r.tag()]}#${r.index()}`, ...used });
  }
}

const submit = emulator.submitTx.bind(emulator);
emulator.submitTx = (cbor) => {
  phaseOne(cbor); // ném lỗi ⟹ giao dịch không vào sổ
  phaseTwo(cbor);
  return submit(cbor);
};

let run = 0;
async function step(file) {
  currentStep = file;
  console.log(`\n━━ ${file} ━━`);
  await import(`./${file}?run=${run++}`);
}
const st = () => JSON.parse(readFileSync(process.env.ORILIFE_FEE_STATE_FILE, "utf8"));
const check = (ok, what) => {
  if (!ok) throw new Error(`KHÔNG ĐẠT: ${what}`);
  console.log(`  ✓ ${what}`);
};

await step("01_mint_test_carp.mjs");
await step("02_open_vault.mjs");
await step("03_collect_fee.mjs");
check(st().collected === (1_000n * 1_000_000_000n).toString(), "sổ ghi 1 000 tCARP sau lượt gom đầu");

// Rác ở hai địa chỉ ai cũng gửi được, bơm thẳng vào sổ Emulator (không phải giao dịch thật —
// thứ được kiểm ở đây là kịch bản NHẶT ô, không phải đường gửi):
//   · 28 ô hộp thư, mỗi ô 1 tCARP — cùng khoản `03` tự nộp là 29, sát trần 30 của một lượt gom;
//   · 2 ô lạc CÓ CARP ở địa chỉ kho (7 tCARP mỗi ô) — phải vào sổ;
//   · 16 ô lạc chỉ-ADA ở địa chỉ kho — nhặt hết thì lượt gom vượt ngân sách (đã đo);
//   · 1 ô lạc mang băm datum không ai có tiền ảnh, 5 tCARP — sổ cái thật bác mọi giao dịch tiêu nó;
//   · 1 ô chỉ-ADA ở địa chỉ kho tạm — `05` từng đòi "đúng 1 ô" ở đó.
const UNIT = 1_000_000_000n;
{
  const s = st();
  const junk = [];
  for (let i = 0; i < 28; i++) junk.push([s.inboxAddress, { lovelace: 1_500_000n, [s.carpUnit]: UNIT }]);
  for (let i = 0; i < 2; i++) junk.push([s.vaultAddress, { lovelace: 1_500_000n, [s.carpUnit]: 7n * UNIT }]);
  for (let i = 0; i < 16; i++) junk.push([s.vaultAddress, { lovelace: 1_200_000n }]);
  junk.push([s.escrowAddress, { lovelace: 1_000_000n }]);
  const fake = "cd".repeat(32);
  junk.forEach(([address, assets], i) => {
    emulator.ledger[fake + i] = { utxo: { txHash: fake, outputIndex: i, address, assets }, spent: false };
  });
  const poison = { txHash: fake, outputIndex: junk.length, address: s.vaultAddress,
    assets: { lovelace: 1_500_000n, [s.carpUnit]: 5n * UNIT }, datumHash: "ab".repeat(32) };
  emulator.ledger[fake + junk.length] = { utxo: poison, spent: false };
}
await step("03_collect_fee.mjs");
check(
  st().collected === ((2_000n + 28n + 14n) * UNIT).toString(),
  "lượt gom thứ hai đưa 29 ô hộp thư + 2 ô lạc có CARP vào sổ (2 042 tCARP)",
);
check((await lucid.utxosAt(st().inboxAddress)).length === 0, "hộp thư trống sau khi gom");
{
  const left = (await lucid.utxosAt(st().vaultAddress)).length;
  check(left === 1 + 16 + 1, `địa chỉ kho còn ô sổ + 17 ô không gom được (đếm ${left})`);
}

await step("04_skim.mjs");
check(st().skimmed === (204_200_000_000n).toString(), "trích đúng 10% làm tròn lên (204,2 tCARP)");

// Một ngày sau khi mở phiên: giá đã rời giá mở nhưng chưa chạm sàn.
emulator.awaitBlock(4_320);
await step("05_swap_and_donate.mjs");
{
  const donated = BigInt(st().donatedLovelace);
  const floor = 204_200_000_000n * 10_000n / UNIT;
  const start = 204_200_000_000n * 100_000n / UNIT;
  check(donated > floor && donated < start, `khoản nộp ${donated} nằm giữa sàn ${floor} và giá mở ${start}`);
}

await step("06_close_vault.mjs");
{
  const s = st();
  const left = await lucid.utxosAt(s.vaultAddress);
  check(left.every((u) => !(u.assets[s.vaultNftUnit] > 0n)), `ô sổ đã bị tiêu; còn ${left.length} ô không gom được, không chặn đóng kho`);
  const nft = Object.values(emulator.ledger).some(({ utxo }) => (utxo.assets[s.vaultNftUnit] ?? 0n) > 0n);
  check(!nft, "NFT sổ đã bị đốt");
}

console.log("\nchi phí thực thi (phase-two, đo trên giao dịch thật đã nộp):");
for (const b of budgets) {
  console.log(`  ${b.step.padEnd(26)} ${b.redeemer.padEnd(10)} mem ${String(b.mem).padStart(9)}  steps ${String(b.steps).padStart(13)}`);
}
console.log(`\nĐẠT — trạng thái tạm: ${process.env.ORILIFE_FEE_STATE_FILE}`);
