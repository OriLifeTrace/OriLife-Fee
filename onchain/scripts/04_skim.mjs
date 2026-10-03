// Trích 10% sang kho tạm. Con số không do kịch bản này chọn — nó tính lại từ chính sổ
// trên chuỗi, đúng công thức mà hợp đồng sẽ kiểm.
//
// Khoản trích mở một phiên đấu giá giảm dần ở kho tạm (`donation_escrow.ak`). Mốc mở phiên
// `listed_at` do hợp đồng ép: ĐÚNG bằng cận trên khoảng hiệu lực của giao dịch này, và khoảng
// đó không rộng quá `LISTING_WINDOW_MS` (`fee_vault.ak` ▸ `escrow_receives`).

import { Data } from "@lucid-evolution/lucid";
import {
  connect, state, saveState, buildScripts, splitVaultUtxos, explorer, awaitTx,
  SKIM_BPS, CARP_SCALE, LISTING_WINDOW_MS,
} from "./common.mjs";
import { VaultDatum, EscrowDatum, VaultRedeemer } from "./schemas.mjs";

const s = state();
const lucid = await connect();
const scripts = buildScripts({
  carpPolicy: s.carpPolicy, carpName: s.carpName, seed: s.seed,
});

const { ledger: vault } = splitVaultUtxos(
  await lucid.utxosAt(scripts.vaultAddress), scripts.vaultNftUnit,
);
const before = Data.from(vault.datum, VaultDatum);

// Nghĩa vụ = (collected × bps / 10000) LÀM TRÒN LÊN, trừ phần đã trích. Làm tròn lên
// vì hợp đồng làm tròn lên; dùng phép chia thường ở đây là kịch bản tự trích thiếu một
// đơn vị so với trần, và kho sẽ không bao giờ đóng lại được (`Close` đòi nghĩa vụ về 0).
const obligation =
  (before.collected * BigInt(SKIM_BPS) + 9_999n) / 10_000n - before.skimmed;
if (obligation <= 0n) { console.log("không còn nghĩa vụ nào để trích"); process.exit(0); }

// `...before` chở `collected` và `operator_key` sang nguyên vẹn.
const after = { ...before, skimmed: before.skimmed + obligation };
const held = vault.assets[scripts.carpUnit] ?? 0n;

// Khoảng hiệu lực tròn giây: Preprod một slot = 1 giây, nên mốc tròn giây đi lên chuỗi rồi
// quay về hợp đồng đúng nguyên giá trị — `listed_at == cận trên` so được bằng dấu bằng.
// Cận dưới lùi 60 giây để giao dịch không bị từ chối vì đồng hồ máy chạy nhanh hơn mạng.
const lower = Math.floor(Date.now() / 1000) * 1000 - 60_000;
const upper = lower + 15 * 60_000;
if (upper - lower > LISTING_WINDOW_MS) throw new Error("khoảng hiệu lực rộng hơn cửa sổ mở phiên");

console.log("sổ trước ", before.collected, "/", before.skimmed);
console.log("nghĩa vụ ", obligation, "=", Number(obligation / CARP_SCALE), "tCARP");
console.log("sổ sau   ", after.collected, "/", after.skimmed);
console.log("mở phiên ", new Date(upper).toISOString());

const tx = await lucid
  .newTx()
  .collectFrom([vault], Data.to({ Skim: { amount: obligation } }, VaultRedeemer))
  .attach.SpendingValidator(scripts.vaultScript)
  .validFrom(lower)
  .validTo(upper)
  .pay.ToContract(
    scripts.vaultAddress,
    { kind: "inline", value: Data.to(after, VaultDatum) },
    {
      lovelace: vault.assets.lovelace,
      [scripts.vaultNftUnit]: 1n,
      [scripts.carpUnit]: held - obligation,
    },
  )
  .pay.ToContract(
    scripts.escrowAddress,
    {
      kind: "inline",
      // `vault` ràng khoản trích này vào ĐÚNG instance kho phí đang chi; `parent: null`
      // khai nó là khoản MỚI, không phải phần dư của một ô kho tạm nào; `listed_at` là mốc
      // mở phiên đấu giá. Sai một trong ba thì hợp đồng từ chối — `escrow_receives`.
      value: Data.to(
        { carp: obligation, vault: scripts.vaultHash, parent: null, listed_at: BigInt(upper) },
        EscrowDatum,
      ),
    },
    { lovelace: 3_000_000n, [scripts.carpUnit]: obligation },
  )
  .complete();

const signed = await tx.sign.withWallet().complete();
const txHash = await signed.submit();
console.log("tx       ", txHash);
console.log("         ", explorer(txHash));
await awaitTx(lucid, txHash, "trích 10%:");
saveState({ skimTx: txHash, skimmed: after.skimmed.toString(), listedAt: upper });
