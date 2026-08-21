# Kho phí OriLife trên Cardano

Phí dịch vụ chảy vào bằng CARP. Một phần cố định của dòng vào — bản thử đặt 10% — là **nghĩa
vụ phải nộp lại kho bạc Cardano**, và nghĩa vụ đó do mã ép, không do quy trình vận hành.

**Đọc kỹ câu này trước, vì tiêu đề dễ đọc quá tay.** Thứ được ép bằng mã là quan hệ giữa
`skimmed` và `collected` trong sổ. `collected` thì KHÔNG có gì ép: nó tăng khi có người gọi
`Collect`, và hợp đồng không biết doanh thu thật của OriLife là bao nhiêu. Ngoài ra giá trị
thật vào kho bạc là `10% × sàn/giá thị trường`, không phải 10% của doanh thu — sàn là hằng số
biên dịch, không có máng giá. Cái hợp đồng bảo đảm là **"không tiêu được phần đã ghi là phải
nộp"**, và chỉ vậy. Đó vẫn mạnh hơn một lời hứa, nhưng nó không phải "10% doanh thu".

## Vì sao ép được bằng mã

Từ kỷ nguyên Conway, thân giao dịch Cardano có trường `treasury_donation` — số lovelace mà
chính giao dịch này nộp thẳng vào kho bạc của mạng. Hợp đồng Plutus V3 đọc được trường đó.

Nên câu "phần đã trích quay về kho bạc" không còn là một lời hứa mà là **điều kiện chi tiêu**:
kho tạm giữ phần đã trích chỉ mở khoá trong một giao dịch có nộp đủ. Không nộp thì không tiêu
được.

## Hai hợp đồng

### `fee_vault` — kho phí

Sổ nằm trong datum, hai con số, ai cũng đọc được thẳng từ UTxO:

| Trường | Nghĩa |
|---|---|
| `collected` | tổng CARP đã từng chảy vào, cộng dồn — **không phải** số dư hiện tại |
| `skimmed` | tổng CARP đã chuyển sang kho tạm, cộng dồn |

| Lệnh | Ai gọi được | Luật |
|---|---|---|
| `Collect { amount }` | bất kỳ ai | `collected` tăng ĐÚNG bằng lượng CARP thật sự vào |
| `Skim { amount }` | bất kỳ ai | phần trích đi đúng về kho tạm, đúng instance kho phí này, và không vượt nghĩa vụ |
| `Operate` | chỉ khoá vận hành | chỉ RÚT được, không nạp được; phần còn lại phải **phủ được nghĩa vụ còn nợ** |
| `Close` | chỉ khoá vận hành | chỉ khi nghĩa vụ đã trả HẾT; không để lại ô kho nào |

Câu chịu lực là dòng `Operate`. Hai dòng trên chỉ là kế toán — kế toán đúng mà tiền vẫn đi hết
thì vô nghĩa.

### `donation_escrow` — kho tạm

Một lối ra duy nhất: giao dịch phải nộp kho bạc ít nhất `số CARP rời đi × sàn tỉ giá`.

**Ai cũng gọi được, cố ý.** Bắt buộc chữ ký OriLife thì OriLife biến mất là lời hứa chết
theo. Đổi lại phải có sàn tỉ giá, nếu không người ngoài đổi giá bèo rồi bỏ túi chênh lệch.

Datum ba trường, và hai trường sau không phải trang trí:

| Trường | Nghĩa | Chặn gì |
|---|---|---|
| `carp` | số CARP UTxO này giữ | khai lệch để lần sau rời kho rẻ hơn thực tế |
| `vault` | băm kho phí đã trích ra khoản này | hai instance kho phí dùng chung MỘT khoản trích |
| `parent` | `None` = khoản vừa trích · `Some(ref)` = phần dư của ô `ref` | khoản MỚI bị đếm nhầm thành "trả lại" |

Cho nộp làm nhiều đợt; phần quay lại kho tạm phải khai đúng số nó giữ, đúng `vault`, và đúng
`parent` là ô vừa bị tiêu.

## Bốn lỗ đã vá — đọc trước khi sửa validator

Bản đầu (`4e9eaf7`) đã chạy thật trên Preprod và một hội đồng gỡ lỗi tìm ra bốn chỗ. Mỗi chỗ
nay có **một bài kiểm chết đúng khi bỏ hàng rào tương ứng** — đã dựng đột biến để xác nhận,
không chỉ viết bài kiểm rồi tin nó có tác dụng.

| # | Lỗ | Vá bằng | Bài kiểm đỏ khi gỡ hàng rào |
|---|---|---|---|
| 1 | Kho tạm đo nghĩa vụ bằng TỔNG output tại địa chỉ mình, nên khoản `Skim` mới vào trong cùng giao dịch bị đếm thành "trả lại" và nghĩa vụ bốc hơi | `parent` trong datum; mọi output ở địa chỉ kho tạm phải khai `parent` là ô đang tiêu | `donate_rejects_a_fresh_skim_in_the_same_transaction`, `partial_release_rejects_a_remainder_pointing_elsewhere` |
| 2 | Hai instance kho phí khác tham số dùng chung MỘT khoản trích: mỗi cái chỉ đếm input cùng băm nên đều thấy mình là input duy nhất | `vault` trong datum, `escrow_receives` đòi `vault == own_hash` | `skim_output_must_name_this_vault` |
| 3 | `Operate` là cửa NẠP không ghi sổ — bơm CARP vào kho mà `collected` đứng yên | `carp_after <= carp_before` | `operate_cannot_add_carp_without_recording_it` |
| 4 | Không đóng được kho, mà mọi nhánh ép `lovelace ra >= lovelace vào` ⟹ ADA giữ chỗ nằm lại vĩnh viễn | thêm `Close`, đòi nghĩa vụ đã trả hết | `close_requires_the_obligation_to_be_settled` |

Lỗ 1 và 2 phải vá CÙNG LƯỢT, không phải trùng hợp: kho tạm không nhận `skim_bps` hay
`operator_key` làm tham số, và thứ tự dựng là escrow TRƯỚC rồi vault mới nuốt `escrowHash`.
Nên xoay khoá vận hành (đường vá của lỗ 4) làm băm vault đổi mà băm kho tạm không đổi — tức
bản vá lỗ 4 tự tạo ra tiền đề cho lỗ 2.

Còn một chỗ nữa, là lỗi TÀI LIỆU chứ không phải lỗi tiền: `math.ak` cũ hứa "nghĩa vụ làm tròn
lên" trong khi `fee_vault.ak` dùng `floor_div` cho cả nghĩa vụ lẫn trần được trích. Nay chỉ còn
một hàm `ceil_div`, dùng ở cả hai chỗ — cùng chiều, nếu không thì phần chênh không trích hết
được và `Close` không bao giờ đạt được.

## Tham số chính sách

Ba con số nằm trong **tham số biên dịch**, không nằm trong biến môi trường. Đổi chúng là đổi
mã biên dịch, tức đổi địa chỉ hợp đồng — không đổi lén được.

| Tham số | Bản thử Preprod |
|---|---|
| `skim_bps` | `1000` = 10% |
| `min_lovelace_per_carp` | `10_000` lovelace mỗi 1 CARP |
| chính sách CARP | `tCARP` — đồng THỬ, xem ghi chú dưới |

## Chạy

```bash
cd onchain/orilife_treasury && aiken check && aiken build
cd .. && node scripts/01_mint_test_carp.mjs
node scripts/02_open_vault.mjs
node scripts/03_collect_fee.mjs
node scripts/04_skim.mjs
node scripts/05_swap_and_donate.mjs
node scripts/06_close_vault.mjs
```

Trạng thái đã triển khai ghi vào `scripts/deployed_preprod.json`; kịch bản đọc lại tệp đó
nên chạy lại không đúc thêm hay mở thêm kho.

## Đã chạy thật trên Preprod — 2026-08-21

Cả vòng đời, bằng validator sau khi vá. Instance mới:

```
kho phí  addr_test1wqt7d59afdfzue5mhhjkzeyxjrts64gp6zphcguf7q25ftg43gmjr
kho tạm  addr_test1wprtlz6pvvpslhwdtkdj629zsed53ajwc0qphzfkgpnzc7ssd72q3
```

| Bước | Giao dịch | Khối | Ghi chú |
|---|---|---|---|
| mở kho | `d78775b0` | 5080008 | 5 tADA giữ chỗ, sổ 0/0 |
| nộp phí | `87bb1f79` | 5080013 | +1000 tCARP, `collected = 10¹²` |
| trích 10% | `05294e43` | 5080017 | 100 tCARP sang kho tạm, `skimmed = 10¹¹` |
| đổi + nộp | `f798ec08` | 5080019 | **`treasury_donation = 1.000.000` lovelace**, phí 1.913.199 |
| đóng kho | `e2cf1e27` | 5080021 | 5 tADA + 900 tCARP về ví; kho phí và kho tạm đều còn 0 UTxO |

**Giá thật của một lượt nộp, đo chứ không ước:** nộp 1,0 tADA vào kho bạc tốn 1,913199 tADA
phí. Chi phí thực thi khai RỘNG TAY trong `scripts/05` (2 M bộ nhớ, 900 M bước) và nút mạng
tính phí theo mức KHAI chứ không theo mức dùng thật — nên phí đó phần lớn là tiền khai thừa,
không phải chi phí thật của hợp đồng. Siết lại con số khai là việc còn để ngỏ; ghi ra đây để
không ai đọc "1,9 ADA phí" thành "hợp đồng nặng".

Instance CŨ (`addr_test1wrxmzy4qjv2a8urrk6fy36ek6336qu82h685wzad6deqauctrwv0c`, ghi trong
`deployed_preprod.json` mục `previous`) còn **5.000.000 lovelace + 900.000 tCARP**. tCARP thì
`Operate` rút ra được; **5 tADA thì không redeemer nào rút được** — đó chính là lỗ 4, và nó
nằm lại đó làm bằng chứng thay vì làm lời kể.

## Ghi chú trung thực

- **`tCARP` là đồng THỬ, không phải CARP thật.** CARP thật chưa phát hành. Chính sách đúc ở
  đây là một chữ ký đơn. Tên `tCARP` nói thẳng điều đó thay vì để người đọc tự nhầm.
- **"Sàn giao dịch" trong bản thử là một địa chỉ ví đóng vai bên mua.** Hợp đồng không quan
  tâm CARP đi đâu — nó chỉ ràng buộc kho bạc phải nhận đủ. Ranh giới đó là cố ý: buộc một
  sàn cụ thể vào mã là buộc luôn rủi ro của sàn đó vào mã.
- **Sàn tỉ giá là con số quản trị chặn đáy, không phải giá thị trường.** Chưa nối máng giá.
  Hệ quả phải nói ra: giá thị trường rơi xuống DƯỚI sàn thì `Donate` lỗ, không ai chạy, và
  CARP trong kho tạm nằm lại cho tới khi có người chịu nộp đủ sàn. Đó là fail-closed nghiêng
  về kho bạc — cố ý, nhưng nó là đóng băng, và người đọc phải biết trước.
- **Kho không có vé định danh (NFT).** Ai cũng gửi được một UTxO rác tới địa chỉ kho, và các
  kịch bản đang đòi "đúng 1 UTxO" nên một UTxO rác là chặn cả tuyến vận hành cho tới khi kịch
  bản biết chọn theo datum. Chưa vá; vá bằng NFT là thêm một chính sách đúc.
- **`collected` không có nguồn tự động.** Không có gì trong `src/` hay `e2e/` gọi `Collect` —
  hôm nay nó là một lệnh chạy tay.
- **`scripts/05` dựng giao dịch bằng thư viện tầng dưới, không qua bộ dựng thường.** Bộ dựng
  chạy thử hợp đồng trước khi trả về giao dịch, mà lúc đó trường nộp kho bạc chưa có nên hợp
  đồng từ chối — vòng lặp không thoát được. Lý do đầy đủ ghi trong đầu tệp đó.
- **Chưa dựng giao dịch tấn công THẬT trên chuỗi.** Lỗ 1 được chứng minh bằng bài kiểm cấp
  validator cộng đột biến (gỡ hàng rào ⟹ đúng bài kiểm đó đỏ), không phải bằng một giao dịch
  bị nút mạng từ chối. Khác biệt đó có thật, ghi ra thay vì để dấu xanh tự nói.

OriLife agent
