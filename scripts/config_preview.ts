// Config Preview testnet cho orilife-fee scripts.
//
// Bí mật (khoá Blockfrost, seed ví) đọc từ BIẾN MÔI TRƯỜNG, hoặc từ `.env` của CHÍNH kho này.
// Trước đây tệp này nạp `.env` của kho LAMP qua một đường dẫn tương đối leo ra ngoài gốc kho:
// một kho đọc tệp bí mật của kho khác thì không ai soát được kho nào đang giữ gì, và đường dẫn
// đó vỡ ngay khi ai đó đặt hai kho ở chỗ khác. `.env` đã nằm trong `.gitignore` (dòng 9).

import dotenv from "dotenv";
import {
  Lucid, Blockfrost,
  applyParamsToScript, validatorToScriptHash, scriptHashToCredential, credentialToAddress,
  type LucidEvolution, type Validator, type Network,
} from "@lucid-evolution/lucid";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: resolve(__dirname, "../.env") });

export const NETWORK: Network = (process.env.NETWORK ?? "Preview") as Network;
export const BLOCKFROST_URL = `https://cardano-${NETWORK.toLowerCase()}.blockfrost.io/api/v0`;
export const BLOCKFROST_KEY = process.env.BLOCKFROST_KEY ?? "";
export const WALLET_SEED    = (process.env.WALLET_SEED ?? "").trim().replace(/\s+/g, " ");
export const LAMP_POLICY_ID = (process.env.LAMP_POLICY_ID ?? "").trim();
export const LAMP_ASSET_NAME = (process.env.LAMP_ASSET_NAME ?? "4c414d50").trim();

/** LAMP unit (policy+name, Lucid format). */
export const LAMP_UNIT = LAMP_POLICY_ID + LAMP_ASSET_NAME;

// Blueprint TƯƠI (vendor — không phụ thuộc LAMP committed plutus.json STALE).
const BLUEPRINT_PATH = resolve(__dirname, "../vendor/treasury-custody.plutus.json");

export function loadCustodyCompiledCode(): string {
  const json = JSON.parse(readFileSync(BLUEPRINT_PATH, "utf8")) as {
    validators: { title: string; compiledCode: string; parameters?: unknown[] }[];
  };
  const v = json.validators.find((x) => x.title === "custody.custody.spend");
  if (!v) throw new Error("custody.custody.spend không thấy trong vendor blueprint.");
  if (!v.parameters || v.parameters.length !== 2) {
    throw new Error(
      "blueprint không còn 2 tham số — nó đã bị dựng lại theo bản LAMP mới hơn, và bản mới dựng ra "
      + "script hash KHÁC, tức địa chỉ khác với custody đã deploy ở scripts/deployed_preview.json. "
      + "Khôi phục tệp từ git, đừng dựng lại. Xem scripts/pin-lamp.sh.");
  }
  return v.compiledCode;
}

/** Placeholder proposal_policy (32-byte hex) — Collect không dùng. */
export const PROPOSAL_POLICY_PLACEHOLDER = "00".repeat(28);
/** ms mỗi epoch (Preview ≈ 1.5 giờ). */
export const MS_PER_EPOCH_PREVIEW = 432_000_000n; // 5 ngày testnet slot → epoch

/** Apply custody validator với params chuẩn. */
export function custodyValidator(): Validator {
  return {
    type: "PlutusV3",
    script: applyParamsToScript(loadCustodyCompiledCode(), [
      PROPOSAL_POLICY_PLACEHOLDER, MS_PER_EPOCH_PREVIEW,
    ] as never),
  };
}

export function custodyAddress(v: Validator): string {
  return credentialToAddress(NETWORK, scriptHashToCredential(validatorToScriptHash(v)));
}

export function assertEnv(): void {
  if (!BLOCKFROST_KEY) throw new Error("thiếu BLOCKFROST_KEY trong LAMP/.env");
  if (!WALLET_SEED)    throw new Error("thiếu WALLET_SEED trong LAMP/.env");
  if (!LAMP_POLICY_ID) throw new Error("thiếu LAMP_POLICY_ID trong LAMP/.env");
}

export async function makeLucid(): Promise<LucidEvolution> {
  assertEnv();
  const lucid = await Lucid(new Blockfrost(BLOCKFROST_URL, BLOCKFROST_KEY), NETWORK);
  lucid.selectWallet.fromSeed(WALLET_SEED);
  return lucid;
}

export function explorerTx(hash: string): string {
  return `https://${NETWORK.toLowerCase()}.cardanoscan.io/transaction/${hash}`;
}

// deployed.json cho orilife-fee/scripts/
export const DEPLOYED_PATH = resolve(__dirname, "deployed_preview.json");

export interface OriLifeDeployedState {
  network: Network;
  custody: { hash: string; address: string };
  lamp: { policyId: string; assetName: string };
  genesis?: { txHash: string; outputIndex: number };
}

export function loadDeployed(): OriLifeDeployedState {
  try {
    return JSON.parse(readFileSync(DEPLOYED_PATH, "utf8")) as OriLifeDeployedState;
  } catch {
    throw new Error("chưa có deployed_preview.json — chạy 01_deploy_custody_preview.ts trước.");
  }
}

export function saveDeployed(s: OriLifeDeployedState): void {
  writeFileSync(DEPLOYED_PATH, JSON.stringify(s, null, 2) + "\n");
}

export async function awaitTx(lucid: LucidEvolution, txHash: string, label = ""): Promise<void> {
  process.stdout.write(`   ⏳ đợi confirm ${label} ${txHash.slice(0, 12)}… `);
  const ok = await lucid.awaitTx(txHash, 300_000); // 5 phút timeout
  if (!ok) throw new Error(`tx ${txHash} không confirm sau timeout`);
  console.log("✓");
}
