// Quỹ nộp kho bạc Cardano mỗi epoch một lần (`validators/epoch_donation.ak`).
//
//   node onchain/scripts/08_epoch_donation.mjs open [quỹ_lovelace] [per_epoch] [idle_epochs]
//   node onchain/scripts/08_epoch_donation.mjs donate [khoản_lovelace|-] [tệp_tóm_tắt.json]
//   node onchain/scripts/08_epoch_donation.mjs reclaim
//
// Mặc định: quỹ 10 tADA, nộp 1 tADA mỗi epoch, chủ quỹ thu hồi được sau 10 epoch nằm yên.
//
// `donate` nộp `per_epoch` khi không nêu khoản. Nêu khoản lớn hơn thì quỹ vẫn chỉ góp `per_epoch`,
// phần dư do ví nộp tự bỏ (validator cho bơm thêm, cấm quỹ mất quá `per_epoch`). Tệp tóm tắt, nếu có,
// đi vào metadata nhãn `DONATION_METADATA_LABEL`: epoch được tất toán, số giao dịch, tổng lovelace,
// gốc Merkle của sổ — để ai cũng đối chiếu được khoản nộp với sổ đã công bố.
// Khoá API nhà cung cấp chuỗi và cụm từ ví nhận qua biến môi trường, như `connect()` trong
// `common.mjs`; kịch bản không tự mở chỗ cất bí mật nào.
//
// Lịch epoch đọc từ Blockfrost (`/genesis` cho độ dài epoch, `/epochs/latest` cho mốc), không
// chép hằng. Lịch là THAM SỐ của validator, nên nó đi vào băm script: `open` ghi lịch đã dùng
// vào tệp trạng thái, `donate`/`reclaim` dựng lại script từ đúng lịch đó và dừng nếu địa chỉ lệch.
//
// `donate` dựng giao dịch bằng thư viện tầng dưới, cùng lý do với `05_swap_and_donate.mjs`: bộ
// dựng chạy thử hợp đồng trước khi trả về giao dịch, lúc đó trường nộp kho bạc chưa có, nên hợp
// đồng từ chối. Ở đây lắp tay, khai chi phí thực thi rộng tay, để nút mạng kiểm lại.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as CML from "@anastasia-labs/cardano-multiplatform-lib-nodejs";
import { utxoToCore, assetsToValue, unixTimeToSlot, slotToUnixTime } from "@lucid-evolution/utils";
import {
  Data, Constr, applyParamsToScript, validatorToAddress, validatorToScriptHash, fromText,
  credentialToAddress,
} from "@lucid-evolution/lucid";
import { HERE, NETWORK, connect, compiledCode, keyHashOf, explorer, awaitTx } from "./common.mjs";
import { EpochDonationDatum } from "./schemas.mjs";

/// Phải khớp `epoch_donation.ak` ▸ `fund_nft_name`.
export const FUND_NFT_NAME = "epoch-donation";

/// Nhãn CIP-20 (`msg`): trình duyệt chuỗi hiện được ngay; các khoá còn lại là tóm tắt sổ.
export const DONATION_METADATA_LABEL = 674n;
const DONATION_MSG = "OriLife Covenant epoch donation";

const DEFAULT_FUND = 10_000_000n;
const DEFAULT_PER_EPOCH = 1_000_000n;
const DEFAULT_IDLE_EPOCHS = 10n;

/// Khai rộng tay cho giao dịch `donate` dựng tay. Số dùng thật đo bằng `aiken check` và bộ giả
/// lập (`08_epoch_donation_emulator.mjs` in ra); mức khai chỉ cần không thấp hơn.
const EX_MEM = 1_000_000n;
const EX_STEPS = 400_000_000n;

/// Lùi cận dưới khỏi đồng hồ máy (lệch đồng hồ với mạng), và độ rộng tối đa của khoảng hiệu lực.
const CLOCK_SLACK_MS = 60_000;
const WINDOW_MS = 600_000;
// Phần ô đặt cọc được phép mất nếu script hỏng; phần còn lại trả về ví qua collateral_return.
// Luật sổ cái đòi ≥ 150% phí, nên mức này đủ cho phí tới 2 tADA.
const COLLATERAL_AT_RISK = 3_000_000n;

const REDEEMER_DONATE = Data.to(new Constr(0, []));
const REDEEMER_RECLAIM = Data.to(new Constr(1, []));

const stateFile = () =>
  process.env.ORILIFE_EPOCH_DONATION_STATE_FILE ?? join(HERE, "epoch_donation_preprod.json");
const readState = () => (existsSync(stateFile()) ? JSON.parse(readFileSync(stateFile(), "utf8")) : {});
function saveState(patch) {
  const next = { ...readState(), ...patch };
  writeFileSync(stateFile(), JSON.stringify(next, null, 2) + "\n");
  return next;
}

// ── Lịch epoch ───────────────────────────────────────────────────────────────

async function blockfrost(path) {
  const key = process.env.BLOCKFROST_PROJECT_ID;
  if (!key) throw new Error("thiếu biến môi trường BLOCKFROST_PROJECT_ID");
  const res = await fetch(`https://cardano-preprod.blockfrost.io/api/v0${path}`, {
    headers: { project_id: key },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Blockfrost ${path}: HTTP ${res.status}`);
  return res.json();
}

/// `{ zeroMs, lengthMs }`: mốc đầu epoch 0 và độ dài một epoch (ms).
///
/// Suy mốc 0 bằng `start_time(epoch mới nhất) − epoch × độ dài` là đúng chỉ khi MỌI epoch dài
/// bằng nhau từ epoch 0. Đúng với Preprod và Mainnet (Byron: 21 600 slot × 20 s; Shelley trở đi:
/// 432 000 slot × 1 s — cùng 432 000 s), nhưng đó là dữ kiện của mạng chứ không phải định lý,
/// nên kiểm lại trên chính số Blockfrost trả về: độ dài epoch mới nhất phải bằng độ dài genesis.
export async function epochSchedule() {
  if (globalThis.__ORILIFE_EPOCH_SCHEDULE__) return globalThis.__ORILIFE_EPOCH_SCHEDULE__;
  const genesis = await blockfrost("/genesis");
  const latest = await blockfrost("/epochs/latest");
  for (const [k, v] of [
    ["genesis.epoch_length", genesis.epoch_length], ["genesis.slot_length", genesis.slot_length],
    ["latest.epoch", latest.epoch], ["latest.start_time", latest.start_time],
    ["latest.end_time", latest.end_time],
  ]) {
    if (!Number.isInteger(v)) throw new Error(`Blockfrost trả ${k} = ${JSON.stringify(v)}, không phải số nguyên`);
  }
  const lengthMs = genesis.epoch_length * genesis.slot_length * 1000;
  if ((latest.end_time - latest.start_time) * 1000 !== lengthMs) {
    throw new Error(
      `epoch ${latest.epoch} dài ${latest.end_time - latest.start_time} s, genesis nói ` +
      `${lengthMs / 1000} s — lịch không đều, công thức mốc 0 không dùng được`,
    );
  }
  return { zeroMs: latest.start_time * 1000 - latest.epoch * lengthMs, lengthMs };
}

export const epochAt = (t, { zeroMs, lengthMs }) => Math.floor((t - zeroMs) / lengthMs);

/// Khoảng hiệu lực nằm TRỌN trong epoch hiện tại, căn theo slot: validator đọc thời điểm của
/// slot, không đọc đồng hồ máy. Trả `{ epoch, lowerSlot, upperSlot, lowerMs, upperMs }`.
export function windowInCurrentEpoch(schedule, now = Date.now()) {
  const epoch = epochAt(now, schedule);
  const start = schedule.zeroMs + epoch * schedule.lengthMs;
  const end = start + schedule.lengthMs; // đầu epoch kế, KHÔNG thuộc epoch này
  let lowerSlot = unixTimeToSlot(NETWORK, Math.max(now - CLOCK_SLACK_MS, start));
  if (slotToUnixTime(NETWORK, lowerSlot) < start) lowerSlot += 1;
  const upperSlot = unixTimeToSlot(NETWORK, Math.min(now + WINDOW_MS, end - 1));
  const lowerMs = slotToUnixTime(NETWORK, lowerSlot);
  const upperMs = slotToUnixTime(NETWORK, upperSlot);
  if (upperMs <= now || epochAt(upperMs, schedule) !== epoch || epochAt(lowerMs, schedule) !== epoch) {
    throw new Error(`epoch ${epoch} sắp hết, không còn khoảng hiệu lực trọn trong nó — chạy lại sau khi sang epoch kế`);
  }
  return { epoch, lowerSlot, upperSlot, lowerMs, upperMs };
}

// ── Script ───────────────────────────────────────────────────────────────────

export function buildFund({ seed, zeroMs, lengthMs }) {
  const script = {
    type: "PlutusV3",
    script: applyParamsToScript(compiledCode("epoch_donation.epoch_donation.spend"), [
      new Constr(0, [seed.txHash, BigInt(seed.outputIndex)]),
      BigInt(zeroMs),
      BigInt(lengthMs),
    ]),
  };
  const hash = validatorToScriptHash(script);
  return { script, hash, address: validatorToAddress(NETWORK, script), unit: hash + fromText(FUND_NFT_NAME) };
}

function fundFromState() {
  const s = readState();
  if (!s.seed || s.zeroMs === undefined || s.lengthMs === undefined) {
    throw new Error(`tệp trạng thái ${stateFile()} chưa có quỹ — chạy 'open' trước`);
  }
  if (s.reclaimTx) throw new Error(`quỹ đã thu hồi ở ${s.reclaimTx}`);
  const fund = buildFund(s);
  if (s.address && s.address !== fund.address) {
    throw new Error(`địa chỉ dựng lại ${fund.address} khác địa chỉ đã ghi ${s.address} — mã validator đã đổi?`);
  }
  return { s, fund, schedule: { zeroMs: s.zeroMs, lengthMs: s.lengthMs } };
}

/// Ô quỹ = ô DUY NHẤT ở địa chỉ quỹ giữ NFT. Ô khác ở đó là rác ai cũng gửi được, không đọc.
async function findFund(lucid, fund) {
  const at = await lucid.utxosAt(fund.address);
  const held = at.filter((u) => (u.assets[fund.unit] ?? 0n) === 1n);
  if (held.length !== 1) throw new Error(`phải có đúng 1 ô giữ NFT quỹ, đang thấy ${held.length}`);
  return { utxo: held[0], datum: Data.from(held[0].datum, EpochDonationDatum), strays: at.length - 1 };
}

/// Tệp trạng thái đã trỏ tới một quỹ (có `address`/`seed`) thì hỏi CHUỖI trước khi chọn seed mới
/// và ghi đè: mất seed + lịch là mất đường dựng lại script của quỹ cũ. Không dựa vào `reclaimTx`
/// — `Reclaim` không cần chữ ký, người lạ thu hồi thì tệp này không bao giờ biết.
async function refuseIfPriorFundMayBeAlive(lucid, prior) {
  if (!prior.address && !prior.seed) return;
  if (!prior.address || !prior.nftUnit || !prior.seed) {
    throw new Error(
      `tệp trạng thái ${stateFile()} có quỹ cũ nhưng thiếu address/nftUnit/seed — không kiểm được nó trên chuỗi, dừng`,
    );
  }
  const held = (await lucid.utxosAt(prior.address)).filter((u) => (u.assets[prior.nftUnit] ?? 0n) > 0n);
  if (held.length > 0) {
    throw new Error(
      `quỹ cũ còn trên chuỗi (${held[0].txHash}#${held[0].outputIndex} ở ${prior.address}) — ` +
      `không mở quỹ mới đè lên tệp trạng thái ${stateFile()}`,
    );
  }
  if (!prior.openTx) {
    // Seed đã ghi mà chưa ghi giao dịch mở: lần `open` trước có thể đã nộp và đang chờ vào khối.
    const seedLeft = await lucid.utxosByOutRef([prior.seed]);
    if (seedLeft.length === 0) {
      throw new Error(
        `seed cũ ${prior.seed.txHash}#${prior.seed.outputIndex} đã bị tiêu nhưng chưa thấy NFT quỹ ở ` +
        `${prior.address} — giao dịch mở cũ có thể đang chờ vào khối. Chờ rồi chạy lại; chắc chắn seed ` +
        `bị tiêu vào việc khác thì tự gỡ address/seed khỏi tệp trạng thái`,
      );
    }
  }
}

/// Min-ADA của đầu ra giữ chỗ chỉ-ADA mà `donate` dựng, đo trên địa chỉ base (khoá + staking).
function minAdaOfPlaceholder(lucid, keyHash) {
  const cred = CML.Credential.new_pub_key(CML.Ed25519KeyHash.from_hex(keyHash));
  const networkId = lucid.config().network === "Mainnet" ? 1 : 0;
  const output = CML.TransactionOutputBuilder.new()
    .with_address(CML.BaseAddress.new(networkId, cred, cred).to_address())
    .next()
    .with_value(CML.Value.from_coin(1n))
    .build()
    .output();
  return minAdaOf(lucid, output);
}

/// Min-ADA sổ cái đòi cho một đầu ra CML, theo `coinsPerUtxoByte` hiện hành.
function minAdaOf(lucid, output) {
  return CML.min_ada_required(output, BigInt(lucid.config().protocolParameters.coinsPerUtxoByte));
}

/// Ô quỹ đi tiếp mà `Donate` dựng: địa chỉ quỹ, datum inline với `last_epoch = epoch`, giữ NFT.
/// `open` đo min-ADA trên CÙNG đầu ra này nên hai lệnh không lệch nhau về kích thước ô.
function nextFundOutput(fund, datum, epoch, lovelace) {
  const nextDatum = CML.PlutusData.from_cbor_hex(
    Data.to({ ...datum, last_epoch: BigInt(epoch) }, EpochDonationDatum),
  );
  return CML.TransactionOutputBuilder.new()
    .with_address(CML.Address.from_bech32(fund.address))
    .with_data(CML.DatumOption.new_datum(nextDatum))
    .next()
    .with_value(assetsToValue({ lovelace, [fund.unit]: 1n }))
    .build();
}

/// Tóm tắt sổ → metadata giao dịch. Hình dạng lạ thì ném: khoản nộp mang tóm tắt sai còn tệ hơn
/// khoản nộp không mang gì, vì người đối chiếu sẽ tin nó.
export function donationMetadata(summary) {
  const keys = ["epoch", "tx_count", "total_lovelace", "merkle_root"];
  const extra = Object.keys(summary ?? {}).filter((k) => !keys.includes(k));
  if (summary === null || typeof summary !== "object" || extra.length) {
    throw new Error(`tóm tắt sổ phải đúng các khoá ${keys.join(", ")}; thừa: ${extra.join(", ") || "(không phải object)"}`);
  }
  const ints = {};
  for (const k of ["epoch", "tx_count", "total_lovelace"]) {
    const v = summary[k];
    if (!(typeof v === "number" && Number.isSafeInteger(v)) && !(typeof v === "string" && /^\d+$/.test(v))) {
      throw new Error(`tóm tắt sổ: '${k}' phải là số nguyên không âm, nhận ${JSON.stringify(v)}`);
    }
    ints[k] = BigInt(v);
    if (ints[k] < 0n) throw new Error(`tóm tắt sổ: '${k}' âm`);
    // Số nguyên metadata tối đa 8 byte; chặn ở đây để lỗi nói đúng trường nào.
    if (ints[k] > 18_446_744_073_709_551_615n) {
      throw new Error(`tóm tắt sổ: '${k}' = ${v} vượt 2^64−1, metadata không mang được`);
    }
  }
  if (typeof summary.merkle_root !== "string" || !/^[0-9a-f]{64}$/.test(summary.merkle_root)) {
    throw new Error("tóm tắt sổ: 'merkle_root' phải là 64 ký tự hex thường (32 byte)");
  }
  // Ba số đi thẳng từ BigInt vào chuỗi JSON: qua `Number()` thì chuỗi số lớn hơn 2^53 bị làm
  // tròn lặng lẽ (ví dụ "9007199254740993" thành 9007199254740992 trên chuỗi).
  const json = JSON.stringify({
    msg: [DONATION_MSG],
    epoch: "__EPOCH__",
    tx_count: "__TX_COUNT__",
    total_lovelace: "__TOTAL__",
    merkle_root: summary.merkle_root,
  })
    .replace('"__EPOCH__"', ints.epoch.toString())
    .replace('"__TX_COUNT__"', ints.tx_count.toString())
    .replace('"__TOTAL__"', ints.total_lovelace.toString());
  const metadata = CML.Metadata.new();
  metadata.set(DONATION_METADATA_LABEL, CML.encode_json_str_to_metadatum(json, CML.MetadataJsonSchema.NoConversions));
  return CML.AuxiliaryData.new_shelley(metadata);
}

// ── Lệnh con ─────────────────────────────────────────────────────────────────

/// `skipLocalChecks` chỉ dành cho bộ giả lập: bỏ phép kiểm "quỹ đủ cho lần nộp đầu" để dựng một
/// quỹ thiếu tiền (validator không cấm) rồi đo `donate` trên nó. Dòng lệnh không truyền cờ này.
export async function open({ fundLovelace = DEFAULT_FUND, perEpoch = DEFAULT_PER_EPOCH, idleEpochs = DEFAULT_IDLE_EPOCHS, skipLocalChecks = false } = {}) {
  const prior = readState();
  if (perEpoch <= 0n || idleEpochs <= 0n) throw new Error("per_epoch và idle_epochs phải lớn hơn 0");

  const lucid = await connect();
  const walletAddress = await lucid.wallet().address();
  await refuseIfPriorFundMayBeAlive(lucid, prior);

  // `donate` cân đối giao dịch bằng một đầu ra GIỮ CHỖ chỉ-ADA đúng `per_epoch` ở ví người nộp,
  // và sổ cái đòi đầu ra đó có min-ADA. `per_epoch` dưới mức đó thì quỹ mở được nhưng không bao
  // giờ nộp được. Đo trên địa chỉ base (khoá + staking) — dạng địa chỉ ví thường dài nhất — vì
  // người nộp là bất kỳ ai, không chỉ ví đang mở quỹ.
  const placeholderMinAda = minAdaOfPlaceholder(lucid, keyHashOf(walletAddress));
  if (perEpoch < placeholderMinAda) {
    throw new Error(
      `per_epoch ${perEpoch} lovelace nhỏ hơn min-ADA ${placeholderMinAda} của đầu ra giữ chỗ mà ` +
      `'donate' phải dựng — quỹ sẽ mở được nhưng không bao giờ nộp được. Chọn per_epoch >= ${placeholderMinAda}`,
    );
  }
  const schedule = await epochSchedule();
  const win = windowInCurrentEpoch(schedule);

  // Seed: UTxO chỉ-ADA NHỎ nhất của ví, và nộp nó TƯỜNG MINH (`collectFrom`) — chọn coin tự động
  // không được phép là thứ duy nhất đưa nó vào giao dịch.
  const candidates = (await lucid.wallet().getUtxos())
    .filter((u) => Object.keys(u.assets).length === 1)
    .sort((a, b) => (a.assets.lovelace < b.assets.lovelace ? -1 : 1));
  if (candidates.length === 0) throw new Error("ví không có UTxO chỉ-ADA nào để làm seed");
  const seedUtxo = candidates[0];
  const seed = { txHash: seedUtxo.txHash, outputIndex: seedUtxo.outputIndex };
  const fund = buildFund({ seed, ...schedule });

  const datum = {
    last_epoch: BigInt(win.epoch - 1),
    per_epoch: perEpoch,
    owner: keyHashOf(walletAddress),
    idle_epochs: idleEpochs,
  };

  // Lần nộp đầu rút `per_epoch` khỏi quỹ và phải để lại một ô quỹ đi tiếp đủ min-ADA (đo trên
  // đúng đầu ra `donate` sẽ dựng). Thiếu thì quỹ mở được mà không bao giờ tự nộp được, và chủ
  // chờ `idle_epochs` epoch mới thu hồi. Kiểm TRƯỚC khi ghi tệp trạng thái và dựng giao dịch.
  if (!skipLocalChecks) {
    const firstRemainder = fundLovelace - perEpoch;
    const minAda = firstRemainder >= 0n
      ? minAdaOf(lucid, nextFundOutput(fund, datum, win.epoch, firstRemainder).output())
      : null;
    if (minAda === null || firstRemainder < minAda) {
      throw new Error(
        `quỹ không đủ cho lần nộp đầu: ${fundLovelace} lovelace < per_epoch ${perEpoch} + min-ADA ` +
        `${minAda ?? "(chưa đo được, quỹ < per_epoch)"} của ô quỹ đi tiếp — quỹ sẽ mở được nhưng ` +
        `không bao giờ nộp được. Bỏ thêm ADA hoặc hạ per_epoch`,
      );
    }
  }
  console.log("lịch epoch  ", schedule, "— epoch hiện tại", win.epoch);
  console.log("địa chỉ quỹ ", fund.address);
  console.log("quỹ         ", fundLovelace, "lovelace; mỗi epoch", perEpoch, "; nằm yên", idleEpochs, "epoch thì ai cũng trả được quỹ về chủ");

  // Ghi seed + lịch TRƯỚC khi nộp: script phụ thuộc vào chúng, mất chúng là mất đường dựng lại.
  saveState({
    network: NETWORK, seed, zeroMs: schedule.zeroMs, lengthMs: schedule.lengthMs,
    address: fund.address, scriptHash: fund.hash, nftUnit: fund.unit, owner: datum.owner,
    openTx: undefined, reclaimTx: undefined,
  });

  const tx = await lucid
    .newTx()
    .collectFrom([seedUtxo])
    .mintAssets({ [fund.unit]: 1n }, Data.void())
    .attach.MintingPolicy(fund.script)
    .pay.ToContract(
      fund.address,
      { kind: "inline", value: Data.to(datum, EpochDonationDatum) },
      { lovelace: fundLovelace, [fund.unit]: 1n },
    )
    .validFrom(win.lowerMs)
    .validTo(win.upperMs)
    .complete();
  const txHash = await (await tx.sign.withWallet().complete()).submit();
  console.log("tx          ", txHash, explorer(txHash));
  await awaitTx(lucid, txHash, "mở quỹ:");
  saveState({ openTx: txHash, openedEpoch: win.epoch });
  return txHash;
}

/// `skipLocalChecks` chỉ dành cho bộ giả lập: dựng và nộp cả khi kịch bản biết trước validator
/// sẽ từ chối, để đo chính validator chứ không đo phép kiểm của kịch bản.
export async function donate({ amount, summary, skipLocalChecks = false } = {}) {
  const auxData = summary === undefined ? undefined : donationMetadata(summary);
  const { fund, schedule } = fundFromState();
  const lucid = await connect();
  const walletAddress = await lucid.wallet().address();
  const { utxo: fundUtxo, datum, strays } = await findFund(lucid, fund);
  const win = windowInCurrentEpoch(schedule);
  const donation = amount ?? datum.per_epoch;
  if (!skipLocalChecks && donation < datum.per_epoch) {
    throw new Error(`khoản nộp ${donation} < per_epoch ${datum.per_epoch} — validator sẽ bác`);
  }
  if (fundUtxo.assets.lovelace < datum.per_epoch) {
    // Không chặn được bằng `skipLocalChecks`: lượng âm không dựng thành đầu ra được.
    throw new Error(
      `quỹ cạn: còn ${fundUtxo.assets.lovelace} lovelace < per_epoch ${datum.per_epoch}. Quỹ không tự nộp ` +
      `được nữa; chủ quỹ thu hồi bằng 'reclaim' sau ${datum.idle_epochs} epoch nằm yên`,
    );
  }
  // Quỹ góp đúng `per_epoch`; phần vượt (nếu có) ví nộp tự bỏ qua ô trả phí.
  const nextLovelace = fundUtxo.assets.lovelace - datum.per_epoch;
  const fromWallet = donation > datum.per_epoch ? donation - datum.per_epoch : 0n;

  console.log("epoch       ", win.epoch, "— nộp lần cuối ở epoch", datum.last_epoch, `(${strays} ô khác ở địa chỉ quỹ, bỏ qua)`);
  console.log("quỹ         ", fundUtxo.assets.lovelace, "→", nextLovelace, "lovelace; nộp", donation, "— ví bù", fromWallet);

  const nextOutput = nextFundOutput(fund, datum, win.epoch, nextLovelace);

  if (!skipLocalChecks) {
    if (BigInt(win.epoch) <= datum.last_epoch) {
      throw new Error(`epoch ${win.epoch} đã nộp rồi — lần kế từ epoch ${datum.last_epoch + 1n}`);
    }
    // Quỹ cạn: ô đi tiếp phải có min-ADA. Hợp đồng cho người gọi tự bù, nhưng kịch bản không
    // tự rút ví vận hành để nuôi quỹ — dừng và nói ra. Phần dư về chủ quỹ qua `reclaim`.
    const minAda = minAdaOf(lucid, nextOutput.output());
    if (nextLovelace < minAda) {
      throw new Error(
        `quỹ cạn: sau khi nộp còn ${nextLovelace} < min-ADA ${minAda}. Quỹ không tự nộp tiếp được; ` +
        `chủ quỹ thu hồi bằng 'reclaim' sau ${datum.idle_epochs} epoch nằm yên`,
      );
    }
  }

  const funding = (await lucid.wallet().getUtxos())
    .filter((u) => Object.keys(u.assets).length === 1 && u.assets.lovelace > 5_000_000n)
    .sort((a, b) => (b.assets.lovelace > a.assets.lovelace ? 1 : -1));
  if (funding.length < 2) throw new Error("cần ít nhất 2 UTxO chỉ-ADA (> 5 tADA) để trả phí và đặt cọc");
  // Ô trả phí = ô LỚN nhất; ô đặt cọc = ô NHỎ nhất còn đủ (> 5 tADA). Script hỏng thì chỉ mất
  // COLLATERAL_AT_RISK, phần còn lại của ô đặt cọc trả về ví qua collateral_return.
  const payer = funding[0];
  const collateral = funding[funding.length - 1];
  // Ô trả phí phải gánh phần ví bù + phí + min-ADA của tiền thừa; 5 tADA là biên rộng cho hai thứ sau.
  if (payer.assets.lovelace < fromWallet + 5_000_000n) {
    throw new Error(
      `ví nộp thiếu: ô chỉ-ADA lớn nhất ${payer.assets.lovelace} lovelace < phần ví bù ${fromWallet} + 5 tADA. ` +
      `Gom ví thành một ô lớn hơn rồi chạy lại`,
    );
  }

  const txb = lucid.newTx().rawConfig().txBuilder;
  txb.set_validity_start_interval(BigInt(win.lowerSlot));
  txb.set_ttl(BigInt(win.upperSlot));

  const scriptWitness = CML.PlutusScriptWitness.new_script(
    CML.PlutusScript.from_v3(CML.PlutusV3Script.from_cbor_hex(fund.script.script)),
  );
  txb.add_input(
    CML.SingleInputBuilder.from_transaction_unspent_output(utxoToCore(fundUtxo))
      .plutus_script_inline_datum(
        CML.PartialPlutusWitness.new(scriptWitness, CML.PlutusData.from_cbor_hex(REDEEMER_DONATE)),
        CML.Ed25519KeyHashList.new(),
      ),
  );
  txb.add_input(CML.SingleInputBuilder.from_transaction_unspent_output(utxoToCore(payer)).payment_key());
  txb.add_collateral(CML.SingleInputBuilder.from_transaction_unspent_output(utxoToCore(collateral)).payment_key());
  txb.set_collateral_return(
    CML.TransactionOutputBuilder.new().with_address(CML.Address.from_bech32(walletAddress)).next()
      .with_value(assetsToValue({ lovelace: collateral.assets.lovelace - COLLATERAL_AT_RISK })).build().output(),
  );

  // Chỉ số redeemer = vị trí của ô quỹ sau khi giao dịch SẮP XẾP đầu vào theo (mã giao dịch, số thứ tự).
  const ordered = [fundUtxo, payer]
    .map((u) => ({ k: `${u.txHash}#${String(u.outputIndex).padStart(6, "0")}`, u }))
    .sort((a, b) => (a.k < b.k ? -1 : 1));
  txb.set_exunits(
    CML.RedeemerWitnessKey.new(CML.RedeemerTag.Spend, BigInt(ordered.findIndex((o) => o.u === fundUtxo))),
    CML.ExUnits.new(EX_MEM, EX_STEPS),
  );

  const wallet = CML.Address.from_bech32(walletAddress);
  txb.add_output(nextOutput); // đầu ra 0: ô quỹ đi tiếp
  // Đầu ra 1: ô GIỮ CHỖ cho khoản nộp — để bộ dựng cân đối đủ tiền, rồi gỡ ra và chuyển đúng
  // ngần ấy sang trường nộp kho bạc. Cân bằng vẫn đúng từng lovelace: vào = ra + phí + nộp.
  txb.add_output(
    CML.TransactionOutputBuilder.new().with_address(wallet).next()
      .with_value(assetsToValue({ lovelace: donation })).build(),
  );
  if (auxData) txb.add_auxiliary_data(auxData);
  const built = txb.build(CML.ChangeSelectionAlgo.Default, wallet).build_unchecked();

  const oldBody = built.body();
  const totalCollateral = oldBody.total_collateral();
  if (totalCollateral === undefined || totalCollateral !== COLLATERAL_AT_RISK || totalCollateral * 2n < oldBody.fee() * 3n) {
    throw new Error(`đặt cọc lệch: total_collateral=${totalCollateral}, phí=${oldBody.fee()} — dừng`);
  }
  const oldOuts = oldBody.outputs();
  const placeholder = oldOuts.get(1);
  if (placeholder.amount().coin() !== donation || (placeholder.amount().multi_asset()?.policy_count() ?? 0) !== 0) {
    throw new Error("đầu ra 1 không phải ô giữ chỗ — bộ dựng đổi thứ tự đầu ra, dừng, đừng đoán");
  }
  const keptOuts = CML.TransactionOutputList.new();
  for (let i = 0; i < oldOuts.len(); i++) if (i !== 1) keptOuts.add(oldOuts.get(i));

  const body = CML.TransactionBody.new(oldBody.inputs(), keptOuts, oldBody.fee());
  const COPIED = [
    ["set_ttl", "ttl"], ["set_validity_interval_start", "validity_interval_start"],
    ["set_network_id", "network_id"], ["set_script_data_hash", "script_data_hash"],
    ["set_collateral_inputs", "collateral_inputs"], ["set_collateral_return", "collateral_return"],
    ["set_total_collateral", "total_collateral"], ["set_reference_inputs", "reference_inputs"],
    ["set_required_signers", "required_signers"], ["set_auxiliary_data_hash", "auxiliary_data_hash"],
  ];
  // Mọi trường tuỳ chọn khác của thân giao dịch Conway. Bản gốc mang bất kỳ trường nào trong số
  // này thì bản dựng lại sẽ LẶNG LẼ đánh rơi nó — ném lỗi thay vì nộp một giao dịch khác ý.
  const NOT_COPIED = [
    "certs", "withdrawals", "mint", "voting_procedures",
    "proposal_procedures", "current_treasury_value", "donation",
  ];
  for (const getter of [...COPIED.map(([, g]) => g), ...NOT_COPIED]) {
    if (typeof oldBody[getter] !== "function") {
      throw new Error(`CML không có TransactionBody.${getter}() — phiên bản lạ, dừng, đừng đoán`);
    }
  }
  const dropped = NOT_COPIED.filter((g) => {
    const v = oldBody[g]();
    return v !== undefined && v !== null;
  });
  if (dropped.length) {
    throw new Error(`thân giao dịch gốc có trường không chép lại được: ${dropped.join(", ")} — dừng`);
  }
  for (const [setter, getter] of COPIED) {
    const v = oldBody[getter]();
    if (v !== undefined && v !== null) body[setter](v);
  }
  if (auxData && body.auxiliary_data_hash() === undefined) {
    throw new Error("có tóm tắt sổ mà thân giao dịch không mang auxiliary_data_hash — dừng");
  }
  body.set_donation(donation);
  const cbor = CML.Transaction.new(body, built.witness_set(), true, built.auxiliary_data()).to_cbor_hex();

  const signed = await lucid.fromTx(cbor).sign.withWallet().complete();
  const txHash = await signed.submit();
  console.log("tx          ", txHash, explorer(txHash));
  await awaitTx(lucid, txHash, "nộp kho bạc:");
  saveState({ lastDonateTx: txHash, lastDonatedEpoch: win.epoch, lastDonation: donation.toString() });
  return { txHash, cbor: signed.toCBOR(), epoch: win.epoch, donation };
}

export async function reclaim() {
  const { fund, schedule } = fundFromState();
  const lucid = await connect();
  const { utxo: fundUtxo, datum } = await findFund(lucid, fund);
  const win = windowInCurrentEpoch(schedule);
  // Không cần chữ ký: ai cũng nộp được, ví đang chọn chỉ trả phí. Toàn bộ lovelace quỹ về ĐÚNG MỘT
  // đầu ra ở địa chỉ khoá bởi `owner`, không phần uỷ quyền, không datum, không script tham chiếu —
  // validator đòi đúng hình dạng đó (`epoch_donation.ak` nhánh `Reclaim`).
  const ownerAddress = credentialToAddress(lucid.config().network, { type: "Key", hash: datum.owner });
  if ((await lucid.wallet().address()) === ownerAddress) {
    // Tiền thừa của ví sẽ thành ô THỨ HAI ở đúng địa chỉ đó và validator bác giao dịch.
    throw new Error(
      `ví nộp có địa chỉ trùng địa chỉ nhận ${ownerAddress}: tiền thừa sẽ thành đầu ra thứ hai ở đó ` +
      `và validator bác — nộp 'reclaim' bằng một ví khác (ai cũng nộp được, không cần chữ ký chủ)`,
    );
  }
  console.log("epoch       ", win.epoch, "— thu hồi được từ epoch", datum.last_epoch + datum.idle_epochs + 1n);
  console.log("trả về      ", fundUtxo.assets.lovelace, "lovelace →", ownerAddress);

  const tx = await lucid
    .newTx()
    .collectFrom([fundUtxo], REDEEMER_RECLAIM)
    .mintAssets({ [fund.unit]: -1n }, Data.void())
    .attach.SpendingValidator(fund.script)
    .pay.ToAddress(ownerAddress, { lovelace: fundUtxo.assets.lovelace })
    .validFrom(win.lowerMs)
    .validTo(win.upperMs)
    .complete();
  const txHash = await (await tx.sign.withWallet().complete()).submit();
  console.log("tx          ", txHash, explorer(txHash));
  await awaitTx(lucid, txHash, "thu hồi:");
  saveState({ reclaimTx: txHash });
  return txHash;
}

// ── Dòng lệnh ────────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  const big = (x, d) => (x === undefined ? d : BigInt(x));
  const commands = {
    open: () => open({ fundLovelace: big(args[0], DEFAULT_FUND), perEpoch: big(args[1], DEFAULT_PER_EPOCH), idleEpochs: big(args[2], DEFAULT_IDLE_EPOCHS) }),
    donate: () => donate({
      amount: args[0] === undefined || args[0] === "-" ? undefined : BigInt(args[0]),
      summary: args[1] === undefined ? undefined : JSON.parse(readFileSync(args[1], "utf8")),
    }),
    reclaim: () => reclaim(),
  };
  if (!commands[command]) {
    console.error("dùng: 08_epoch_donation.mjs open [quỹ_lovelace] [per_epoch] [idle_epochs] | donate [khoản_lovelace|-] [tệp_tóm_tắt.json] | reclaim");
    process.exit(2);
  }
  await commands[command]();
}
