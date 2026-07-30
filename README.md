# @orilife/fee

Cơ chế tính **phí tác vụ người dùng OriLife** và **cầu nối nạp LAMP về các bucket treasury**
(dùng lại lớp LAMP Treasury Collect, không viết on-chain mới).

## Ý tưởng một dòng

Người dùng làm tác vụ (đăng ký cây, quét định danh, neo on-chain…) → `quoteFee` định giá ra
LAMP, chia về 3 bucket (PROTOCOL / LAMPNET_REWARD / ANCHOR) → `buildFeeCollectTx` dựng MỘT
giao dịch Collect nạp toàn bộ phí vào treasury, validator Plutus `custody.custody.spend` ép
bảo toàn `Σout=Σin` (LAMP fixed-supply, KHÔNG đốt).

## Chạy

```bash
npm install
npm test                # 54 test: định giá + cầu nối + 3 test giao dịch qua validator Plutus thật
npm run e2e:emulator    # in bằng chứng: 1 giao dịch Collect, 8 bất biến ✅, txHash thật
npm run typecheck
```

> `vendor/treasury-custody.plutus.json` là blueprint custody build lại từ nguồn LAMP hiện tại
> (committed `LAMP/Treasury/onchain/plutus.json` đang STALE — thiếu params). Tái dựng:
> `bash scripts/rebuild-blueprint.sh` (cần `aiken`).

## Tài liệu

`OriLife-Specs/Fee/`: `FeeMechanism-CONTRACT.md` (xương sống) · `-FEAT.md` · `-MATH.md` ·
`-TECH.md` · `-EXEC.md`. Báo cáo build + phản biện: `AUDIT.md`.

## Kiến trúc (tóm tắt)

```
quoteFee (feeEngine) ──FeeQuote──▶ quoteToCollectItems (bridge) ──CollectItem[]──▶
  buildFeeCollectTx (treasuryClient) ──▶ buildCollectTx (@magiclamp/treasury-sdk) ──▶
  validator custody.ak Collect ──▶ custody UTxO: value += feeOil, sổ 3 bucket += oil
```

Lớp `src/params|buckets|tasks|feeEngine|bridge` thuần off-chain (test không cần repo LAMP).
Chỉ `treasuryClient` + `e2e/` chạm Treasury SDK.
