# AUDIT — orilife-fee (cơ chế phí OriLife → treasury)

**Ngày:** 2026-06-09
**Phạm vi:** Lõi định giá phí tác vụ người dùng OriLife + cầu nối nạp LAMP về các bucket
treasury, chứng minh bằng 1 giao dịch Collect qua validator Plutus `custody.custody.spend` thật.

---

## 1. File đã tạo

### Code (`orilife-fee/`)
| File | Vai trò |
|---|---|
| `src/params.ts` | Hằng số kinh tế DAO-governed + biên an toàn (lampUsd, cut, resource split, cap) |
| `src/buckets.ts` | Phân loại bucket treasury (PROTOCOL/LAMPNET_REWARD/ANCHOR ↔ category 0/1/2) |
| `src/tasks.ts` | Danh mục 9 tác vụ + hồ sơ định giá + DAO setter có biên |
| `src/feeEngine.ts` | `quoteFee` (định giá), `splitOil` (chia bucket), `demandFactorFromSignals`, `DemandController` |
| `src/bridge.ts` | `quoteToCollectItems`, `assertBridgeInvariants`, `utf8ToHex` — interface contract → Treasury |
| `src/treasuryClient.ts` | `buildFeeCollectTx` — gọi LAMP Treasury `buildCollectTx` thật |
| `src/index.ts` | Barrel export |
| `e2e/harness.ts` | Harness emulator tái dùng (1 + N collect qua validator thật) |
| `e2e/collect_emulator.ts` | Script in ấn bằng chứng |
| `tests/feeEngine.test.ts` | 44 test định giá + bảo toàn + biên DAO + bigint |
| `tests/bridge.test.ts` | 7 test cầu nối |
| `tests/emulator.integration.test.ts` | 3 test giao dịch qua validator Plutus thật (gồm multi-collect) |
| `vendor/treasury-custody.plutus.json` | Blueprint custody TƯƠI (vì committed LAMP plutus.json STALE) |
| `scripts/rebuild-blueprint.sh` | Tái dựng blueprint từ nguồn LAMP (không đụng repo LAMP) |

### Tài liệu (`OriLife-Specs/Fee/`)
`FeeMechanism-CONTRACT.md` (xương sống), `-FEAT.md`, `-MATH.md`, `-TECH.md`, `-EXEC.md`.

---

## 2. Logic chính

1. **Định giá** (`feeEngine.quoteFee`): phí USD = `(base + valueAdd) × demand × anchorTier ×
   eventMult`, kẹp `≤ min(0.5×truyền_thống, 100 USD)`; quy đổi USD→oil bằng **bigint thuần**
   (tất định, không tràn float). Chia về 3 bucket, ANCHOR hấp thụ dư ⇒ `Σ bucket = feeOil`.
2. **Cầu nối** (`bridge` + `treasuryClient`): FeeQuote → `CollectItem[]` (mỗi bucket 1 item,
   `category` = bucket, `amount` = oil). Kiểm bất biến (cut_bps=10000, Σ khớp, asset ∈ accepted)
   trước khi gọi `buildCollectTx`.
3. **On-chain**: instance custody OriLife `cut_bps=10000` ⇒ `cut = amount` ⇒ toàn bộ phí vào
   treasury, chia 3 bucket trong 1 giao dịch (1 custody in/out). Validator `custody.ak` nhánh
   Collect ép C-MINT-0/C-COL-1..5 (không đốt, Σout=Σin, sổ += Σcut đúng bucket).

---

## 3. Phản biện (2 nhóm agent red-team) + xử lý

| ID | Mức | Phát hiện | Xử lý |
|---|---|---|---|
| H-1 | Cao | `demandFactor` nhận từ client → ghim 0.5 trả phí tối thiểu; EMA không wire | Đánh dấu TRUSTED SERVER INPUT + thêm `DemandController` (nguồn server); tầng API phải chặn field từ client (ghi rõ) |
| H-2 | Cao | Tín hiệu MAGIC consumed/generated không xác thực | DEFER v1.1 (wire oracle MAGIC AppEconomics) — ghi gap trong EXEC |
| H-3 | Cao | `feeOil` tính qua float64 → phi-tất-định + mất chính xác >2⁵³ | **SỬA**: chuyển sang bigint thuần (`feeUsdMicro × OIL / lampUsdMicro`) |
| M-1 | Trung | DAO setter thiếu biên → DoS (lampUsd≈0) / phí âm | **SỬA**: `daoSetLampUsd` kẹp [10⁻⁶,10⁶]; `daoSetTask` ép field ≥0 + valueBps ≤ 1000 |
| M-2 | Trung | Cap neo vào traditionalCost tự khai → tautology | **SỬA**: thêm trần tuyệt đối `MAX_FEE_USD_ABSOLUTE=100` |
| M-3 | Trung | `RESOURCE_SPLIT_BPS.anchor` không dùng; split lệch không báo | **SỬA**: `assertResourceSplitSound()` ép Σ=10000 lúc load |
| L-1 | Thấp | client hạ `anchorTier` về no_anchor né phí neo | **SỬA**: tác vụ on-chain khoá tier ≥ defaultAnchorTier |
| L-2 | Thấp | `feeOil=0` → tác vụ miễn phí lọt | **SỬA**: sàn `MIN_FEE_OIL=1000` khi feeUsd>0 |
| L-3 | Thấp | cut_bps=10000 chỉ ép off-chain | Ghi rõ trong CONTRACT: deploy phải verify cut_bps; mọi đường qua `assertBridgeInvariants` |
| B1 | Trung | mirror `CollectItem` ép `as` che lệch type câm | **SỬA**: assertion type-equality lúc biên dịch (`_ItemCompat`) |
| B2 | Trung | thiếu test multi-collect (nhánh sổ incremental) | **SỬA**: `runEmulatorMultiCollect` + test 2 collect qua validator thật |
| B3 | Thấp | không kiểm asset ∈ accepted_assets | **SỬA**: `BRIDGE-004` trong `buildFeeCollectTx` |

Trục được xác nhận AN TOÀN (không sửa): bảo toàn Σ=feeOil (chứng minh MATH §5), floor chống
khai thấp, `utf8ToHex`, `itemCut(_,10000)=amount`, không rò rỉ thứ tự iteration.

---

## 4. Test coverage / bằng chứng

```
npx tsc --noEmit   → sạch
npm test           → 54 test PASS (44 feeEngine + 7 bridge + 3 emulator integration)
npm run e2e:emulator → giao dịch Collect qua validator Plutus thật, 8 bất biến ✅, txHash thật
```
Integration test chạy giao dịch THẬT qua `custody.custody.spend` trong Lucid Emulator (không
cần ví/faucet/Blockfrost): nạp phí LAMP về 3 bucket, value bảo toàn Σout=Σin, sổ cộng dồn đúng
qua 2 giao dịch.

---

## 5. Hướng deploy (testnet Preview)

Xem TECH §6. Cần: ví Preview funded (tADA) + Blockfrost key (`MAGIC/.env BLOCKFROST_TOKEN_GREENSUN`)
+ mint LAMP test + deploy custody instance `cut_bps=10000`. Lõi định giá + cầu nối dùng nguyên,
chỉ thay emulator bằng provider Blockfrost + ví thật.

---

## 6. TODO & rủi ro còn lại

- **[BÁO ANH — LAMP repo]** `LAMP/Treasury/onchain/plutus.json` STALE (build trước khi thêm
  params `proposal_policy/ms_per_epoch`). Cần `aiken build` + commit lại. Script Treasury
  `01_deploy_custody.ts`/`02_collect_e2e.ts` over-apply params lên blueprint stale → fail
  on-chain. Nên thêm kiểm `parameters.length` trong `applyValidator`. (PoC né bằng blueprint
  tự build ở `vendor/`.)
- **[DEFER v1.1]** Oracle LAMP/USD (Score DEX TWAP); xác thực tín hiệu cầu (H-2); wire MAGIC
  ConsumeMAGIC/AppEconomics (repo read-only — chờ spec); chi node LampNet qua Release+vesting.
- **[Tích hợp]** orilife-core (Python) gọi lớp TS này (gateway HTTP hoặc service) — chưa wire.
- **Rủi ro**: tham số kinh tế hiện là placeholder mô phỏng (DAO chỉnh thật sau); cap tuyệt đối
  100 USD/tác vụ cần DAO xác nhận hợp lý theo loại tài sản.
