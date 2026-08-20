# STATUS — đo ngày 2026-07-30, lần đầu đưa thư mục này vào git

Thư mục này tồn tại từ trước nhưng **chưa từng nằm dưới git nào** (`git rev-parse` trả
`fatal: not a git repository`). Commit đầu là để **chặn mất dữ liệu**, không phải để tuyên bố xong.
File này ghi số ĐO ĐƯỢC, không ghi "test xanh".

## Quy mô thật

23 file mã người viết, **1483 dòng** `.ts`. Tổng thư mục 202 MB, **toàn bộ là `node_modules/`** (đã
`.gitignore`). Không có `.env`, không có khoá nào trong cây (đã soát trước khi `git add`).

## Kiểm — XANH (đo lại 2026-08-20)

```
npx tsc --noEmit     → 0 lỗi
npx vitest run       → 54 / 54 pass (4 tệp)
```

Trước đó `tsc` 1 lỗi và `vitest` 51/54, cả ba cùng gốc `src/treasuryClient.ts:66`
(`CollectParams` thiếu `validFromMs`, `msPerEpoch`). Nguyên nhân thật không nằm ở tệp đó.

**Kho này nhập thẳng mã LAMP qua đường dẫn tương đối leo ra ngoài gốc kho** (`../../../LAMP/...`,
12 chỗ). Nghĩa là nó biên dịch với BẤT KỲ commit nào LAMP đang ở trên đĩa người chạy. LAMP đổi
giao diện `custody` từ 2 sang 3 tham số ngày 15/06 (`8e485b3`), nên từ hôm đó kho này đỏ trên mọi
máy — mà thông điệp lỗi lại nói về `CollectParams` chứ không nói về commit. Ba lỗi đỏ là một triệu
chứng của việc **không ghim phụ thuộc**, không phải một lỗi mã.

Vá: `scripts/pin-lamp.sh` dựng `vendor/lamp` là bản LAMP ghim đúng commit `ebafc2e` — commit CUỐI
CÙNG còn khớp blueprint `vendor/treasury-custody.plutus.json`, tức khớp custody instance đã dựng
trên Preview. `vendor/lamp/` nằm trong `.gitignore`: ghim commit, không chép mã của kho khác vào
kho này.

## Custody Preview còn sống — đã đo

Câu treo từ 30/07 ("chưa kiểm địa chỉ đó còn UTxO thật hay chỉ genesis") nay có câu trả lời.
Blockfrost Preview, `addresses/addr_test1wzz0uxpt58vllu2patcldqa7dvgwkr2j5yagcs8s9lmh37gq34gs9`,
đo 20/08:

```
lovelace                12.000.000
28e916b0…4c414d50 (LAMP) 19.500.000
+ 3 NFT (tres-resev, treasury-lamp, …)
```

Nhiều UTxO, có inline datum `orilife-fee-v1` với sổ bucket ba dòng. **Địa chỉ đó đang giữ tài sản
thật.** Suy ra: dựng lại blueprint theo LAMP mới là đổi script hash, tức đổi địa chỉ, tức mất khả
năng chi tiêu chỗ tài sản đó. Đó là lý do ghim, không phải sở thích.

## `scripts/rebuild-blueprint.sh` đã bị XOÁ

Nó `cp` blueprint từ LAMP ở HEAD bất kỳ, ghi đè bản đang khớp, rồi **thoát 0 như thể thành công**.
Thay bằng `scripts/pin-lamp.sh`, làm đúng việc ngược lại: ghim, và từ chối nếu không ghim được.

## Còn phải làm

1. Lớp cầu nối (`src/treasuryClient.ts`, `e2e/`, `scripts/*_preview.ts`) chỉ biên dịch được khi có
   kho LAMP trên đĩa. Phần lõi (`feeEngine`, `bridge`, `buckets`, `tasks`) không cần LAMP. Kho công
   khai mà lớp cầu nối cần một kho riêng tư là một ràng buộc thật, phải nói ra trong README chứ
   không để người ngoài tự vấp.
2. `src/tasks.ts:28` tự khai danh mục giá là `PLACEHOLDER mô phỏng`. Danh mục phí đang chạy thật là
   `orilife-core/MassTreeIdentify/core/animal_fee.py::TASK_CATALOG`.
3. Hai thế hệ mã phí cùng nằm trong kho này (`main` dùng lại LAMP Treasury Collect trên Preview;
   nhánh `claude/hop-dong-phi-carp-preprod` tự viết validator CARP trên Preprod). Chưa tệp nào nói
   cái nào là hiện hành.

## Quan hệ với MCR

**Không có.** Đây là hệ phí/kế toán, không đụng nhận-diện cây. Câu "nhất quán với MCR chưa" không
áp cho thư mục này. Nhà thật của catalog phí đang chạy production là
`orilife-core/MassTreeIdentify/core/animal_fee.py::TASK_CATALOG`, **không phải** `src/tasks.ts` ở
đây — grep toàn `orilife-core` không có caller nào trỏ sang thư mục này.

OriLife agent
