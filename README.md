# @orilife/fee

Cơ chế tính **phí tác vụ người dùng OriLife** và **cầu nối nạp LAMP về các bucket treasury**
(dùng lại lớp LAMP Treasury Collect, không viết on-chain mới).

## Ý tưởng một dòng

Người dùng làm tác vụ (đăng ký cây, quét định danh, neo on-chain…) → `quoteFee` định giá ra
LAMP, chia về 3 bucket (PROTOCOL / LAMPNET_REWARD / ANCHOR) → `buildFeeCollectTx` dựng MỘT
giao dịch Collect nạp toàn bộ phí vào treasury, validator Plutus `custody.custody.spend` ép
bảo toàn `Σout=Σin` (LAMP fixed-supply, KHÔNG đốt).

## Hai lớp, và chỉ một lớp chạy được khi clone về

Nói ngay để người ngoài không mất thời gian: **lớp cầu nối cần kho LAMP, kho đó hiện chưa công
khai.** Lớp lõi thì không cần gì cả.

| | Cần LAMP? | Gồm |
|---|---|---|
| **Lõi** | không | `feeEngine` (định giá) · `bridge` (bất biến) · `buckets` · `tasks` |
| **Cầu nối** | có | `treasuryClient` · `e2e/` · `scripts/*_preview.ts` |

### Chạy lớp lõi — clone về là chạy

```bash
npm install
npx tsc --noEmit -p tsconfig.core.json
npx vitest run tests/feeEngine.test.ts tests/bridge.test.ts   # 51 test
```

Đây cũng đúng là thứ cổng CI kiểm (`.github/workflows/ci.yml`, job `core`). Cổng đó nói thẳng ra
những gì nó không phủ, thay vì để một dấu xanh ngụ ý nó đã phủ cả những thứ nó không chạm tới.

### Chạy đủ cả hai lớp — cần kho LAMP trên đĩa

```bash
bash scripts/pin-lamp.sh    # dựng vendor/lamp, ghim commit ebafc2e
npm test                    # 54 test
npm run typecheck
npm run e2e:emulator        # in bằng chứng: 1 giao dịch Collect, 8 bất biến, txHash thật
```

`scripts/pin-lamp.sh` **ghim** LAMP vào đúng một commit, không lấy HEAD. Lý do nằm ở đầu tệp đó và
đáng đọc trước khi đụng vào: commit `ebafc2e` là commit cuối cùng còn khớp với
`vendor/treasury-custody.plutus.json`, tức khớp với custody instance đã dựng trên Preview. Địa chỉ
đó đang giữ tài sản thật. Dựng lại blueprint theo LAMP mới hơn là đổi script hash, tức đổi địa chỉ,
tức mất khả năng chi tiêu chỗ tài sản đó.

`vendor/lamp/` nằm trong `.gitignore`: kho này ghim commit của kho khác, không chép mã của kho khác
vào mình.

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
