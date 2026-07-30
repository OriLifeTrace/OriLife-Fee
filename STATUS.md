# STATUS — đo ngày 2026-07-30, lần đầu đưa thư mục này vào git

Thư mục này tồn tại từ trước nhưng **chưa từng nằm dưới git nào** (`git rev-parse` trả
`fatal: not a git repository`). Commit đầu là để **chặn mất dữ liệu**, không phải để tuyên bố xong.
File này ghi số ĐO ĐƯỢC, không ghi "test xanh".

## Quy mô thật

23 file mã người viết, **1483 dòng** `.ts`. Tổng thư mục 202 MB, **toàn bộ là `node_modules/`** (đã
`.gitignore`). Không có `.env`, không có khoá nào trong cây (đã soát trước khi `git add`).

## Kiểm — CHƯA XANH

- `npx tsc --noEmit`: **1 lỗi**
  `src/treasuryClient.ts(66,36): error TS2345` — `CollectParams` thiếu `validFromMs`, `msPerEpoch`.
- `npx vitest run`: **51 / 54 pass, 3 fail**, cả 3 fail trong `tests/emulator.integration.test.ts`,
  cùng một gốc: `buildFeeCollectTx` tại `src/treasuryClient.ts:66`.

Ba lỗi này là **một** lỗi: client TS đã đi theo LAMP mới, blueprint đóng gói thì chưa.

## ⚠️ ĐỪNG CHẠY `scripts/rebuild-blueprint.sh`

Nó `cp "$TMP/plutus.json" "$ROOT/vendor/treasury-custody.plutus.json"` (dòng 26), build từ
`/Users/ductiger/Projects/LAMP/Treasury/onchain` **ở HEAD hiện tại**, rồi ghi đè, và thoát 0.

Đã đo, hai bên KHÁC nhau về số tham số:

| validator | vendor `treasury-custody.plutus.json` | LAMP HEAD |
|---|---|---|
| `custody.spend` | **2** tham số: `proposal_policy`, `ms_per_epoch` | **3**: `proposal_policy`, **`seed_policy`**, `ms_per_epoch` (`validators/custody.ak:47-51`) |
| `custody_seed.mint` | **2**: `genesis_ref`, `custody_script_hash` | **1**: `genesis_ref` (`validators/custody_seed.ak:64`) |

Đổi tham số là đổi mã biên dịch, tức đổi script hash, tức **đổi địa chỉ**. Bản trong `vendor/` là
hiện vật DUY NHẤT còn khớp địa chỉ custody đã deploy trên Preview:
`addr_test1wzz0uxpt58vllu2patcldqa7dvgwkr2j5yagcs8s9lmh37gq34gs9`
(`scripts/deployed_preview.json`). Chạy script đó là mất khả năng chi tiêu UTxO đang nằm ở đó.

Muốn dựng lại đúng bản này thì phải checkout LAMP về commit khớp 2 tham số rồi mới build, chứ
không chạy script ở HEAD.

## Còn phải làm

1. Chốt: nâng client TS theo LAMP 3 tham số (rồi deploy custody MỚI), hay ghim LAMP về bản 2 tham
   số để giữ instance đã deploy. Đây là quyết định, không phải lỗi cần vá.
2. `scripts/deployed_preview.json` — chưa kiểm địa chỉ đó còn UTxO thật hay chỉ genesis. Cần khoá
   Blockfrost Preview còn hiệu lực.
3. Sửa `rebuild-blueprint.sh`: thêm cổng đối chiếu số tham số trước khi `cp`, và bắt ghim commit
   LAMP tường minh thay vì lấy HEAD.
4. `README.md:17` ghi "54 test", `AUDIT.md`/EXEC ghi "43 test" — hai số chỏi nhau, chọn một.

## Quan hệ với MCR

**Không có.** Đây là hệ phí/kế toán, không đụng nhận-diện cây. Câu "nhất quán với MCR chưa" không
áp cho thư mục này. Nhà thật của catalog phí đang chạy production là
`orilife-core/MassTreeIdentify/core/animal_fee.py::TASK_CATALOG`, **không phải** `src/tasks.ts` ở
đây — grep toàn `orilife-core` không có caller nào trỏ sang thư mục này.

OriLife agent
