// Nền chung cho mọi kịch bản chạy trên Preprod.
//
// Nguyên tắc: KHÔNG kịch bản nào tự khai một địa chỉ hay một băm script. Mọi thứ suy ra
// từ `plutus.json` do `aiken build` sinh, nên bản trên chuỗi và bản trong mã không thể
// lệch nhau mà không ai biết.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Lucid, Blockfrost, applyParamsToScript, validatorToAddress,
  validatorToScriptHash, validatorToRewardAddress, paymentCredentialOf, fromText, Constr,
} from "@lucid-evolution/lucid";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..");
/// Bộ chạy giả lập (`lifecycle_emulator.mjs`) trỏ tệp trạng thái sang tệp tạm để không
/// đụng nhật ký Preprod thật.
export const STATE_FILE = process.env.ORILIFE_FEE_STATE_FILE ?? join(HERE, "deployed_preprod.json");

export const NETWORK = "Preprod";

/// Đọc bí mật từ `$AGENT_SECRETS`. Giá trị có thể nằm trong dấu nháy kép — bỏ nháp
/// ở đây một lần thay vì mỗi chỗ dùng lại quên.
export function secret(key) {
  const raw = execSync(`grep '^${key}=' "$AGENT_SECRETS" | cut -d= -f2-`, {
    shell: "/bin/zsh",
  }).toString().trim();
  if (!raw) throw new Error(`không tìm thấy biến ${key} trong $AGENT_SECRETS`);
  return raw.replace(/^"(.*)"$/s, "$1");
}

// ── Tham số chính sách ───────────────────────────────────────────────────────
// Các con số dưới đây là TOÀN BỘ chính sách phí, và chúng nằm trong tham số biên dịch
// chứ không nằm trong một biến môi trường nào — đổi chúng là đổi địa chỉ hợp đồng, tức
// là không đổi lén được. Đây là giá trị thử của instance Preprod.

/// 10% dòng vào là nghĩa vụ nộp lại kho bạc Cardano.
export const SKIM_BPS = 1_000;

/// Sàn tỉ giá: mỗi 1 CARP rời kho tạm phải kéo theo tối thiểu ngần này lovelace vào
/// kho bạc. Đây là con số quản trị chặn đáy, không phải giá thị trường.
export const MIN_LOVELACE_PER_CARP = 10_000;

/// Giá mở phiên đấu giá giảm dần (10× sàn). Giá mỗi CARP đi thẳng từ đây xuống sàn trong
/// `DECAY_MS`; người gọi `Donate` sớm trả gần giá mở, nên không còn quyền chọn miễn phí ở sàn.
export const START_LOVELACE_PER_CARP = 100_000;

/// Độ dài phiên đấu giá: 7 ngày.
export const DECAY_MS = 604_800_000;

/// Độ rộng tối đa của khoảng hiệu lực giao dịch `Skim`. `listed_at` = cận trên của khoảng
/// đó, nên phiên mở trong vòng một giờ kể từ lúc trích: không lùi được, không đẩy xa được.
export const LISTING_WINDOW_MS = 3_600_000;

/// Lượng nhả tối thiểu mỗi lần `Donate` (đơn vị nhỏ nhất): `released >= min(held, LOT_MIN)`.
/// Không có nó thì nối chuỗi `Donate` 1 đơn vị giữ chặt ô kho tạm, chặn người mua khác cho
/// tới khi giá về sàn.
export const LOT_MIN = 10_000_000_000n;

/// Tên NFT định danh sổ kho phí. Phải khớp `types.ak` ▸ `vault_nft_name`.
export const VAULT_NFT_NAME = "orilife-fee-vault";

/// Một CARP nguyên = 10⁹ đơn vị nhỏ nhất (`nanothread`).
export const CARP_SCALE = 1_000_000_000n;

export const TEST_CARP_NAME = "tCARP";

export function blueprint() {
  const path = join(ROOT, "orilife_treasury", "plutus.json");
  if (!existsSync(path)) {
    throw new Error(`chưa có ${path} — chạy 'aiken build' trong onchain/orilife_treasury trước`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

export function compiledCode(title) {
  const found = blueprint().validators.find((v) => v.title === title);
  if (!found) throw new Error(`không thấy validator '${title}' trong plutus.json`);
  return found.compiledCode;
}

export async function connect() {
  // Bộ chạy giả lập cài sẵn một Lucid nối Emulator; có nó thì không đọc khoá, không gọi mạng.
  if (globalThis.__ORILIFE_FEE_LUCID__) return globalThis.__ORILIFE_FEE_LUCID__;
  const lucid = await Lucid(
    new Blockfrost(
      "https://cardano-preprod.blockfrost.io/api/v0",
      secret("Blockfrost_Aladin_Preprod"),
    ),
    NETWORK,
  );
  lucid.selectWallet.fromSeed(secret("FOUNDATION_SEED"));
  return lucid;
}

export function state() {
  return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
}

export function saveState(patch) {
  const next = { ...state(), ...patch };
  writeFileSync(STATE_FILE, JSON.stringify(next, null, 2) + "\n");
  return next;
}

/// Trường dùng chung cho mọi instance (ví, đồng CARP thử) — mọi trường khác ở gốc tệp
/// trạng thái thuộc về instance kho đang mở.
const SHARED_KEYS = new Set([
  "network", "wallet", "operatorKeyHash", "carpPolicy", "carpName", "carpUnit", "mintTx",
  "previous", "closed",
]);

/// Tệp trạng thái là NHẬT KÝ những gì đã chạy trên Preprod, không chỉ là con trỏ tới
/// instance hiện tại. Trước khi mở instance mới: instance ở gốc tệp đã đóng thì dời
/// nguyên trạng vào `closed` (giữ thứ tự); chưa đóng thì dừng — mở kho mới khi kho cũ
/// còn tài sản là bỏ lại tài sản đó.
export function archiveClosedInstance() {
  const s = state();
  const own = Object.keys(s).filter((k) => !SHARED_KEYS.has(k));
  if (own.length === 0) return s;
  if (!s.closeTx) {
    throw new Error("instance ở gốc tệp trạng thái chưa đóng — chạy 06_close_vault.mjs trước");
  }
  const archived = Object.fromEntries(own.map((k) => [k, s[k]]));
  const next = Object.fromEntries(Object.entries(s).filter(([k]) => SHARED_KEYS.has(k)));
  next.closed = [...(s.closed ?? []), archived];
  writeFileSync(STATE_FILE, JSON.stringify(next, null, 2) + "\n");
  return next;
}

/// Dựng các hợp đồng từ tham số. Thứ tự bắt buộc: kho tạm → kho phí (nhận băm kho tạm và
/// `seed`) → hộp thư phí (nhận băm kho phí). Ngược lại là vòng tròn.
///
/// `seed` = `{ txHash, outputIndex }` của một UTxO ví mà giao dịch mở kho sẽ tiêu. Nó làm
/// NFT sổ thành đúc-một-lần: tiêu xong thì không giao dịch nào thoả `Open` được nữa. Nên
/// `seed` phải được chọn và GHI vào tệp trạng thái TRƯỚC khi mở kho (`02_open_vault.mjs`).
export function buildScripts({ carpPolicy, carpName, operatorKeyHash, seed }) {
  if (!seed) throw new Error("thiếu `seed` — chạy 02_open_vault.mjs để chọn và ghi seed trước");
  const nameHex = fromText(carpName);

  const escrowScript = {
    type: "PlutusV3",
    script: applyParamsToScript(compiledCode("donation_escrow.donation_escrow.spend"), [
      carpPolicy,
      nameHex,
      BigInt(MIN_LOVELACE_PER_CARP),
      BigInt(START_LOVELACE_PER_CARP),
      BigInt(DECAY_MS),
      LOT_MIN,
    ]),
  };
  const escrowHash = validatorToScriptHash(escrowScript);

  const vaultScript = {
    type: "PlutusV3",
    script: applyParamsToScript(compiledCode("fee_vault.fee_vault.spend"), [
      carpPolicy,
      nameHex,
      BigInt(SKIM_BPS),
      escrowHash,
      operatorKeyHash,
      BigInt(LISTING_WINDOW_MS),
      new Constr(0, [seed.txHash, BigInt(seed.outputIndex)]),
    ]),
  };
  const vaultHash = validatorToScriptHash(vaultScript);

  const inboxScript = {
    type: "PlutusV3",
    script: applyParamsToScript(compiledCode("fee_inbox.fee_inbox.spend"), [
      carpPolicy,
      nameHex,
      vaultHash,
    ]),
  };

  return {
    escrowScript,
    escrowHash,
    escrowAddress: validatorToAddress(NETWORK, escrowScript),
    vaultScript,
    vaultHash,
    vaultAddress: validatorToAddress(NETWORK, vaultScript),
    // Chính sách của NFT sổ = băm kho phí (validator hai mặt mint + spend).
    vaultNftUnit: vaultHash + fromText(VAULT_NFT_NAME),
    inboxScript,
    inboxHash: validatorToScriptHash(inboxScript),
    inboxAddress: validatorToAddress(NETWORK, inboxScript),
    // Cùng script, vai stake credential: lượt gom rút 0 lovelace từ đây để mặt `withdraw`
    // chạy MỘT lần cho cả lô (mẫu withdraw-zero); credential phải được đăng ký một lần.
    inboxRewardAddress: validatorToRewardAddress(NETWORK, inboxScript),
    carpUnit: carpPolicy + nameHex,
  };
}

/// Ô sổ kho phí là UTxO DUY NHẤT giữ NFT sổ. Các UTxO khác ở cùng địa chỉ là ô lạc (gửi
/// nhầm): chúng được gom vào sổ qua `Collect`, không được đọc như sổ.
export function splitVaultUtxos(utxos, vaultNftUnit) {
  const ledger = utxos.filter((u) => (u.assets[vaultNftUnit] ?? 0n) === 1n);
  if (ledger.length !== 1) {
    throw new Error(`phải có đúng 1 ô sổ giữ NFT ở địa chỉ kho, đang thấy ${ledger.length}`);
  }
  return { ledger: ledger[0], strays: utxos.filter((u) => u !== ledger[0]) };
}

/// Ô ở địa chỉ permissionless (hộp thư, địa chỉ kho) mà kịch bản được phép nhặt. Ai cũng gửi
/// được vào những địa chỉ đó, nên nhặt mù là để người ngoài quyết giao dịch của mình có dựng
/// được không: ô mang băm datum không ai có tiền ảnh bị sổ cái bác ở phase-1, ô mang reference
/// script lớn đội phí và chạm trần kích thước. Chỉ nhặt ô CÓ CARP, xếp CARP giảm dần, cắt ở
/// `limit` — ô bị bỏ lại không mất gì, lượt sau vẫn gom được.
export function sweepable(utxos, carpUnit, limit) {
  const carpOf = (u) => u.assets[carpUnit] ?? 0n;
  const ok = utxos.filter((u) => carpOf(u) > 0n && !u.scriptRef && !(u.datumHash && !u.datum));
  ok.sort((a, b) => (carpOf(b) > carpOf(a) ? 1 : carpOf(b) < carpOf(a) ? -1 : 0));
  return { picked: ok.slice(0, limit), skipped: utxos.length - Math.min(ok.length, limit) };
}

/// Khoản nộp kho bạc tối thiểu cho `released` đơn vị CARP rời kho tạm tại thời điểm `t`
/// (POSIX ms, = cận dưới khoảng hiệu lực của giao dịch `Donate`). Chép từ
/// `donation_escrow.ak` — công thức đấu giá giảm dần, MỘT lần làm tròn lên; lệch với bản
/// trên chuỗi thì nút mạng từ chối giao dịch, không có gì mất.
export function requiredDonation(released, listedAt, t) {
  const floor = BigInt(MIN_LOVELACE_PER_CARP);
  const start = BigInt(START_LOVELACE_PER_CARP);
  const decay = BigInt(DECAY_MS);
  const elapsed = BigInt(t) - BigInt(listedAt);
  const remaining = elapsed <= 0n ? decay : elapsed >= decay ? 0n : decay - elapsed;
  const numerator = released * (floor * decay + (start - floor) * remaining);
  const denominator = CARP_SCALE * decay;
  return (numerator + denominator - 1n) / denominator;
}

export function keyHashOf(address) {
  return paymentCredentialOf(address).hash;
}

export function explorer(txHash) {
  return `https://preprod.cardanoscan.io/transaction/${txHash}`;
}

export async function awaitTx(lucid, txHash, label) {
  process.stdout.write(`  ${label} chờ xác nhận `);
  const ok = await lucid.awaitTx(txHash);
  console.log(ok ? "xong" : "KHÔNG XÁC NHẬN ĐƯỢC");
  return ok;
}
