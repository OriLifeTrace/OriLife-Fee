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
  validatorToScriptHash, paymentCredentialOf, fromText,
} from "@lucid-evolution/lucid";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..");
export const STATE_FILE = join(HERE, "deployed_preprod.json");

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
// Ba con số dưới đây là TOÀN BỘ chính sách phí, và chúng nằm trong tham số biên dịch
// chứ không nằm trong một biến môi trường nào — đổi chúng là đổi địa chỉ hợp đồng, tức
// là không đổi lén được.

/// 10% dòng vào là nghĩa vụ nộp lại kho bạc Cardano.
export const SKIM_BPS = 1_000;

/// Sàn tỉ giá: mỗi 1 CARP rời kho tạm phải kéo theo tối thiểu ngần này lovelace vào
/// kho bạc. Đây là con số quản trị chặn đáy, không phải giá thị trường.
export const MIN_LOVELACE_PER_CARP = 10_000;

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

/// Dựng cả hai hợp đồng từ tham số. Thứ tự bắt buộc: kho tạm trước, vì kho phí nhận
/// băm của kho tạm làm tham số. Ngược lại là vòng tròn.
export function buildScripts({ carpPolicy, carpName, operatorKeyHash }) {
  const nameHex = fromText(carpName);

  const escrowScript = {
    type: "PlutusV3",
    script: applyParamsToScript(compiledCode("donation_escrow.donation_escrow.spend"), [
      carpPolicy,
      nameHex,
      BigInt(MIN_LOVELACE_PER_CARP),
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
    ]),
  };

  return {
    escrowScript,
    escrowHash,
    escrowAddress: validatorToAddress(NETWORK, escrowScript),
    vaultScript,
    vaultHash: validatorToScriptHash(vaultScript),
    vaultAddress: validatorToAddress(NETWORK, vaultScript),
    carpUnit: carpPolicy + nameHex,
  };
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
