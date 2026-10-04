# Kho phí OriLife trên Cardano

Phí dịch vụ chảy vào bằng CARP. Một phần cố định của dòng vào — bản thử đặt 10% — là **nghĩa
vụ phải nộp lại kho bạc Cardano**, và nghĩa vụ đó do mã ép, không do quy trình vận hành.

**Đọc kỹ câu này trước, vì tiêu đề dễ đọc quá tay.** Thứ được ép bằng mã là quan hệ giữa
`skimmed` và `collected` trong sổ. `collected` chỉ đếm CARP **đi qua hộp thư phí hoặc rơi
vào địa chỉ kho**: hợp đồng không biết doanh thu thật của OriLife là bao nhiêu, và một khoản
phí trả thẳng vào ví khác thì không bao giờ vào sổ. Ngoài ra giá trị thật vào kho bạc là
`10% × giá đấu lúc nộp`, không phải 10% của doanh thu — giá đấu đi từ giá mở xuống sàn, cả
hai là hằng số biên dịch, không có máng giá. Cái hợp đồng bảo đảm là **"không tiêu được phần
đã ghi là phải nộp"**, và chỉ vậy. Đó vẫn mạnh hơn một lời hứa, nhưng nó không phải "10%
doanh thu".

## Vì sao ép được bằng mã

Từ kỷ nguyên Conway, thân giao dịch Cardano có trường `treasury_donation` — số lovelace mà
chính giao dịch này nộp thẳng vào kho bạc của mạng. Hợp đồng Plutus V3 đọc được trường đó.

Nên câu "phần đã trích quay về kho bạc" không còn là một lời hứa mà là **điều kiện chi tiêu**:
kho tạm giữ phần đã trích chỉ mở khoá trong một giao dịch có nộp đủ. Không nộp thì không tiêu
được.

## Ba hợp đồng

```
ConsumeMAGIC ──(CARP, datum hoàn hoặc không datum)──▶ fee_inbox ──gom (ai cũng gọi)──▶ fee_vault ──Skim──▶ donation_escrow ──Donate──▶ kho bạc Cardano
```

### `fee_vault` — kho phí

**Sổ được định danh bằng NFT, không bằng địa chỉ.** Ô sổ là UTxO DUY NHẤT ở địa chỉ kho giữ
NFT `orilife-fee-vault`, chính sách đúc = chính băm `fee_vault`. NFT đúc một lần: hợp đồng nhận
`seed` (một UTxO ví) làm tham số, và lệnh đúc `Open` đòi giao dịch tiêu đúng UTxO đó. `Open`
còn ép ô sổ mở ra ở đúng địa chỉ kho, sổ `0/0`, không CARP, không reference script, và khoá
vận hành ghi trong sổ phải ký giao dịch mở. `Close` phải đốt NFT. Không có NFT thì một UTxO bất kỳ mang datum tự đặt ở địa chỉ kho trông y hệt sổ.

Mọi UTxO khác ở địa chỉ kho là **ô lạc** (gửi nhầm, có hay không có datum). Ô lạc chỉ được
tiêu cùng ô sổ trong một `Collect`, và sổ phải tăng ít nhất bằng số CARP của ô lạc. `Skim` và
`Close` từ chối giao dịch có ô lạc; `Operate` nhận ô lạc chỉ-ADA (CARP ở ô sổ không đổi), không
nhận ô lạc có CARP. Hệ quả cần biết: phần **không phải CARP** của ô
lạc (ADA, token lạ, reference script) ai gom thì người đó lấy — nên đừng bao giờ đặt reference
script ở địa chỉ kho hay hộp thư.

Sổ nằm trong datum, ai cũng đọc được thẳng từ UTxO:

| Trường | Nghĩa |
|---|---|
| `collected` | tổng CARP đã từng chảy vào, cộng dồn — **không phải** số dư hiện tại |
| `skimmed` | tổng CARP đã chuyển sang kho tạm, cộng dồn |
| `operator_key` | băm khoá vận hành hiện tại. Nằm trong datum, không phải tham số biên dịch, để xoay khoá không đổi băm kho |

| Lệnh | Ai gọi được | Luật |
|---|---|---|
| `Collect { amount }` | bất kỳ ai | `collected` tăng ĐÚNG bằng lượng CARP thật sự vào ô sổ, và không ít hơn tổng CARP của MỌI đầu vào khoá bằng script khác trong giao dịch; `operator_key` giữ nguyên |
| `Skim { amount }` | bất kỳ ai | phần trích đi đúng về kho tạm, đúng instance kho phí này, không vượt nghĩa vụ, và mở phiên đấu giá tại đúng cận trên khoảng hiệu lực; `operator_key` giữ nguyên |
| `Operate` | chỉ khoá vận hành (trong datum đầu vào) | chỉ RÚT được, không nạp được; phần còn lại phải **phủ được nghĩa vụ còn nợ**; `operator_key` giữ nguyên |
| `Rotate` | khoá vận hành hiện tại **và** khoá mới cùng ký | ô sổ ở lại đúng địa chỉ, giá trị y nguyên (ADA, NFT, CARP, token khác), `collected`/`skimmed` y nguyên; chỉ `operator_key` đổi; không nhận ô lạc có CARP |
| `Close` | chỉ khoá vận hành (trong datum đầu vào) | chỉ khi nghĩa vụ đã trả HẾT; đốt NFT sổ; không để lại ô kho nào |

**Xoay khoá vận hành là `Rotate`, không phải `Close`.** `Close` là tắt VĨNH VIỄN: NFT sổ bị đốt,
và `fee_inbox` chỉ gom được vào một sổ còn giữ NFT của đúng băm kho nó bake. Trước khi `Close`
phải gom hết hộp thư — ô CARP nào còn ở hộp thư lúc đóng là mất đường vào sổ mãi mãi. Hợp đồng
không chặn được điều này: ô hộp thư không nằm trong giao dịch đóng kho, và một validator không
thấy UTxO ngoài giao dịch của nó. `06_close_vault.mjs` chặn ở ngoài chuỗi: còn ô CARP gom được ở
hộp thư hoặc địa chỉ kho thì dừng. Ai dựng giao dịch `Close` bằng tay thì không có hàng rào đó.

Khoá mới phải ký `Rotate` vì một băm không ai cầm khoá ghi vào sổ là mất vĩnh viễn `Operate`,
`Rotate` và `Close`. Cùng lý do, `Open` đòi khoá ghi trong sổ trắng ký giao dịch mở.

Câu chịu lực là dòng `Operate`. Hai dòng trên chỉ là kế toán — kế toán đúng mà tiền vẫn đi hết
thì vô nghĩa.

Vế "mọi đầu vào khoá bằng script" của `Collect` là có chủ ý, không phải "mọi ô hộp thư": hộp thư
biết băm kho, kho không biết băm hộp thư. Đổi mã hộp thư (hay dựng lại kho) là có hai phiên bản
hộp thư cùng sống, và mỗi phiên bản chỉ cộng CARP của chính nó — một lượt gom hai bên mà sổ chỉ
tăng bằng phần một bên thì mỗi bên đều thấy mình đủ. Kho là bên sống lâu, nên phép so đặt ở kho
và phủ mọi phiên bản hộp thư về sau.

### `fee_inbox` — hộp thư phí

Giao dịch ConsumeMAGIC không thể kèm một `Collect`: nó chỉ tiêu ô của chính nó và vault MAGIC.
Nên phí nền tảng bằng CARP rời giao dịch đó dưới dạng **một đầu ra không datum** tới địa chỉ
hộp thư — không đầu vào script, không chữ ký OriLife. Gom vào sổ là một giao dịch riêng, và
**ai cũng gom được**: hộp thư không đòi chữ ký, chỉ đòi kho nhận đủ.

Kiểm theo mẫu *withdraw-zero*: mặt `spend` của mỗi ô hộp thư chỉ kiểm giao dịch có rút từ
stake credential của chính hộp thư; mặt `withdraw` chạy MỘT lần cho cả lô và kiểm: đúng một
đầu vào và một đầu ra giữ NFT sổ, sổ tăng ít nhất bằng tổng CARP của mọi ô hộp thư và mọi ô
lạc ở địa chỉ kho trong giao dịch. Phép kiểm sổ chỉ chạy một lần, nhưng mặt `spend` của mỗi ô
vẫn dò danh sách đầu vào để tìm lần rút, nên tổng chi phí tăng nhanh hơn tuyến tính theo số ô
(bảng đo ở mục "Chi phí thực thi đo trên Emulator": khoảng 3,9 K mem thêm cho mỗi vị trí). Trần
30 ô hộp thư mỗi lượt của `03` đặt theo bảng đó.
Mặt `publish` chỉ cho **đăng ký** credential (làm một lần lúc mở kho); huỷ đăng ký hay uỷ quyền
đều bị từ chối.

ADA giữ chỗ của ô hộp thư KHÔNG datum không bị ràng buộc — về tay người gom. Đó là động cơ để
người ngoài OriLife cũng gom.

Ô mang `InlineDatum` `InboxDatum { refund }` (`types.ak`) là ô có hoàn: min-ADA của nó do bên trả
phí hộ ứng. Khi gom, mỗi credential `refund` phải nhận lại tổng `lovelace − refund_fee` của các ô
mang nó (`fee_inbox.ak` ▸ hằng `refund_fee`, ▸ `refunds_paid`); người gom giữ `refund_fee` mỗi ô.
Đầu ra hoàn chỉ được tính khi: địa chỉ là đúng credential đó không kèm phần uỷ quyền, mang
`InlineDatum` bằng băm của chính phiên bản hộp thư đang gom, và không có reference script — thẻ
băm này chặn hai phiên bản hộp thư cùng trỏ một kho dùng chung một đầu ra hoàn. Datum sai hình được
gom như ô không datum. Bên ứng phải soát datum đúng từng byte trước khi ký (chú thích đầu
`fee_inbox.ak`).

### `donation_escrow` — kho tạm

Một lối ra duy nhất: giao dịch phải nộp kho bạc ít nhất `số CARP rời đi × giá đấu`.

**Ai cũng gọi được, cố ý.** Bắt buộc chữ ký OriLife thì OriLife biến mất là lời hứa chết
theo. Đổi lại phải có giá chặn, nếu không người ngoài đổi giá bèo rồi bỏ túi chênh lệch.

**Giá là một phiên đấu giá giảm dần, không phải một sàn cố định.** Mỗi khoản trích mở một
phiên tại `listed_at`; giá mỗi CARP đi thẳng từ `start_lovelace_per_carp` xuống
`min_lovelace_per_carp` trong `decay_ms`, rồi đứng ở sàn. Giá tính tại **cận dưới** khoảng
hiệu lực của giao dịch `Donate` (bắt buộc hữu hạn), làm tròn lên một lần:

```
giá(t) = sàn + (giá mở − sàn) × max(0, decay − (t − listed_at)) / decay
phải nộp = ceil(released × giá(t) / 10⁹)
```

Với sàn cố định, người gọi `Donate` có một quyền chọn miễn phí: luôn nộp đúng sàn dù CARP
đáng giá hơn nhiều. Giá giảm dần lấy lại phần chênh đó cho kho bạc — ai muốn CARP sớm phải
trả gần giá mở.

Ba luật chặn những cách lách giá, cùng nằm trong `spend`:

- **Không script nào khác chạy trong giao dịch `Donate`** (giao dịch có đúng một redeemer).
  `treasury_donation` là một con số cho cả giao dịch, không ghi nguồn: hai instance kho tạm khác
  tham số (hay bất kỳ script nào cũng đòi `donated >= x`) mà cùng giao dịch thì cùng đọc một
  khoản nộp, và kho bạc chỉ nhận mức lớn nhất thay vì tổng. Hệ quả: đổi CARP qua DEX bằng script
  phải là một giao dịch riêng.
- **Lượng nhả tối thiểu `released >= min(held, lot_min)`.** Không có nó thì nối chuỗi `Donate` 1
  đơn vị giữ chặt ô kho tạm (mỗi lần đổi output reference), loại người mua khác cho tới khi giá về
  sàn.
- **Tối đa một ô dư; ô dư có CARP > 0 và lovelace không ít hơn ô vào.** ADA giữ chỗ của ô kho tạm
  chỉ ra khi nhả TRỌN lô — nếu không, một lần nhả 1 đơn vị là lấy được nó. Ô dư 0 CARP thì không
  bao giờ tiêu lại được.

Datum bốn trường, và không trường nào là trang trí:

| Trường | Nghĩa | Chặn gì |
|---|---|---|
| `carp` | số CARP UTxO này giữ | khai lệch để lần sau rời kho rẻ hơn thực tế |
| `vault` | băm kho phí đã trích ra khoản này | hai instance kho phí dùng chung MỘT khoản trích |
| `parent` | `None` = khoản vừa trích · `Some(ref)` = phần dư của ô `ref` | khoản MỚI bị đếm nhầm thành "trả lại" |
| `listed_at` | mốc mở phiên (POSIX ms) | mở phiên lùi về quá khứ để mua ngay ở sàn |

`listed_at` do `fee_vault` ép lúc `Skim`: đúng bằng cận trên khoảng hiệu lực của giao dịch
trích, và khoảng đó không rộng quá `listing_window_ms`. Cho nộp làm nhiều đợt; phần quay lại
kho tạm phải khai đúng số nó giữ, đúng `vault`, đúng `parent` là ô vừa bị tiêu, và **giữ
nguyên `listed_at`** — tách lô không khởi động lại phiên.

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

Lỗ 1 và 2 phải vá CÙNG LƯỢT, không phải trùng hợp: kho tạm không nhận `skim_bps` hay `seed`
làm tham số, và thứ tự dựng là escrow TRƯỚC rồi vault mới nuốt `escrowHash`. Nên đổi tỉ lệ
trích hay mở instance mới làm băm vault đổi mà băm kho tạm không đổi — hai instance kho phí
cùng sống với một kho tạm là tiền đề của lỗ 2. (Bản trước còn dùng "đóng kho rồi mở instance
mới" làm đường xoay khoá vận hành; nay khoá nằm trong datum và xoay bằng `Rotate`, băm vault
không đổi.)

Còn một chỗ nữa, là lỗi TÀI LIỆU chứ không phải lỗi tiền: `math.ak` cũ hứa "nghĩa vụ làm tròn
lên" trong khi `fee_vault.ak` dùng `floor_div` cho cả nghĩa vụ lẫn trần được trích. Nay chỉ còn
một hàm `ceil_div`, dùng ở cả hai chỗ — cùng chiều, nếu không thì phần chênh không trích hết
được và `Close` không bao giờ đạt được.

## Tham số chính sách

Mọi con số dưới đây nằm trong **tham số biên dịch**, không nằm trong biến môi trường. Đổi
chúng là đổi mã biên dịch, tức đổi địa chỉ hợp đồng — không đổi lén được. Giá trị nằm ở khối
"Tham số chính sách" trong `scripts/common.mjs`; bảng này chỉ nói hợp đồng nào nhận gì.

| Tham số | Hợp đồng nhận | Bản thử Preprod |
|---|---|---|
| `skim_bps` | `fee_vault` | `SKIM_BPS` |
| `listing_window_ms` | `fee_vault` | `LISTING_WINDOW_MS` |
| `seed` | `fee_vault` | UTxO ví chọn lúc mở kho, ghi ở `deployed_preprod.json` |
| `min_lovelace_per_carp` (sàn) | `donation_escrow` | `MIN_LOVELACE_PER_CARP` |
| `start_lovelace_per_carp` (giá mở) | `donation_escrow` | `START_LOVELACE_PER_CARP` |
| `decay_ms` (độ dài phiên) | `donation_escrow` | `DECAY_MS` |
| `lot_min` (lượng nhả tối thiểu) | `donation_escrow` | `LOT_MIN` |
| `vault_hash` | `fee_inbox` | băm `fee_vault` của instance |
| chính sách CARP (`carp_policy`, `carp_name`) | cả ba | instance hiện hành: CARP đời 6 (`carpPolicy`/`carpName` ở gốc `deployed_preprod.json`); instance cũ dùng `tCARP` thử |

Thứ tự dựng bắt buộc: `donation_escrow` → `fee_vault` (nhận băm kho tạm và `seed`) →
`fee_inbox` (nhận băm kho phí). Ngược lại là vòng tròn. Giá trị Mainnet của bộ tham số đấu
giá chưa có: đó là giá trị THỬ, không phải chính sách — trước Mainnet phải đặt lại từ số đo.

## Chạy

```bash
cd onchain/orilife_treasury && aiken check && aiken build
cd ../.. && node onchain/scripts/lifecycle_emulator.mjs    # trọn vòng đời trên Emulator, không chạm mạng
node onchain/scripts/01_mint_test_carp.mjs                # từ đây trở đi là Preprod thật
node onchain/scripts/02_open_vault.mjs     # chọn seed, đúc NFT sổ, đăng ký credential hộp thư
# mở kho cho một đồng CARP có sẵn trên chuỗi thay vì tCARP (bỏ qua 01):
ORILIFE_FEE_CARP_POLICY=<56 hex> ORILIFE_FEE_CARP_NAME=<tên tài sản hex> node onchain/scripts/02_open_vault.mjs
node onchain/scripts/03_collect_fee.mjs    # nộp phí vào hộp thư, rồi gom hộp thư + ô lạc vào sổ
node onchain/scripts/04_skim.mjs           # trích 10%, mở phiên đấu giá
node onchain/scripts/05_swap_and_donate.mjs
NEW_OPERATOR_SEED='<cụm từ ví khoá mới>' node onchain/scripts/07_rotate_operator.mjs   # xoay khoá vận hành tại chỗ (khi cần)
node onchain/scripts/06_close_vault.mjs    # TẮT VĨNH VIỄN: đốt NFT, thu ADA giữ chỗ — chạy bằng ví của khoá vận hành trong sổ
```

`07` không đổi băm kho, địa chỉ kho, NFT sổ hay địa chỉ hộp thư. Sau `07`, `06` phải chạy bằng
ví của khoá MỚI (`06` đối chiếu ví với `operator_key` trong sổ và dừng nếu lệch).

Hai giới hạn của bản này:
- `connect()` trong `common.mjs` luôn chọn cùng một ví, chưa có cách chọn ví vận hành riêng. Sau
  khi xoay sang ví khác, `06` và `07` dừng ở bước đối chiếu ví (báo lỗi, không gửi giao dịch) cho
  tới khi ví mà `connect()` chọn là ví của khoá mới. `lifecycle_emulator.mjs` không gặp chỗ này vì
  nó tiêm ví trực tiếp.
- Gõ `NEW_OPERATOR_SEED='…'` ngay trên dòng lệnh thì shell ghi cụm từ vào tệp lịch sử. Gõ một dấu
  cách ở đầu lệnh (zsh với `HIST_IGNORE_SPACE`, bash với `HISTCONTROL=ignorespace`), hoặc đọc bằng
  `read -rs NEW_OPERATOR_SEED && export NEW_OPERATOR_SEED` trước khi chạy. Kịch bản không in và
  không ghi cụm từ ra tệp; nó chỉ in băm khoá mới.

Trạng thái đã triển khai ghi vào `scripts/deployed_preprod.json`; kịch bản đọc lại tệp đó
nên chạy lại không đúc thêm hay mở thêm kho. Tệp đó là **nhật ký**: `02` dời instance đã
đóng vào mảng `closed` (kèm đồng CARP nó dùng) trước khi mở instance mới, và dừng nếu instance
cũ chưa đóng. `carpName` trong tệp là tên tài sản dạng **hex**; `buildScripts` dừng nếu gặp
dạng chữ. Mảng `strayOpen` giữ instance còn mở nhưng KHÔNG phải instance hiện hành (xem ghi chú
trong từng bản ghi) — phí chỉ đi vào hộp thư của instance ở gốc tệp.

`lifecycle_emulator.mjs` chạy ĐÚNG các kịch bản trên (không bản sao) trên Emulator của Lucid,
với tệp trạng thái tạm. Emulator không tự chạy validator lúc nhận giao dịch, nên bộ chạy chạy
lại phase-two (`eval_phase_two_raw`, cùng bộ đánh giá Lucid dùng) cho MỌI giao dịch có
redeemer — kể cả `05`, giao dịch dựng tay không đi qua bước chạy thử của bộ dựng. Kịch bản
gồm một ô lạc ở địa chỉ kho và một ô lạc ở hộp thư, để lượt gom thứ hai phải đưa cả hai vào
sổ. Sau `05`, bộ chạy xoay khoá vận hành bằng `07`, kiểm địa chỉ kho/NFT/hộp thư và giá trị ô sổ
không đổi, nộp phí vào hộp thư rồi gom vào CÙNG sổ, trích và nộp lần nữa, thử `Close` bằng khoá
CŨ (phải bị validator bác; đối chứng cùng bộ dựng với khoá mới thì qua), rồi đóng kho bằng `06`
dưới ví khoá MỚI. Hai chỗ Emulator KHÔNG thay được Preprod: nó không kiểm cân bằng giá trị, và không kiểm
trường `treasury_donation` ở tầng sổ cái — validator thấy trường đó, sổ cái giả thì không.

## Đã chạy thật trên Preprod — 2026-08-21

Cả vòng đời, bằng bản validator của ĐỢT VÁ 2026-08-21. Instance khi đó:

```
kho phí  addr_test1wqt7d59afdfzue5mhhjkzeyxjrts64gp6zphcguf7q25ftg43gmjr
kho tạm  addr_test1wprtlz6pvvpslhwdtkdj629zsed53ajwc0qphzfkgpnzc7ssd72q3
```

> **Hai địa chỉ trên là BẢN GHI LỊCH SỬ, không phải địa chỉ của mã trong kho hôm nay.**
> Đợt vá 2026-09-27 (ghim địa chỉ ĐẦY ĐỦ thay cho băm script, và cấm reference script trên
> ô kho — mục 5 ở đầu `fee_vault.ak`) đổi cả hai băm script chưa-áp-tham-số. Băm đã deploy
> là `fee_vault` `457a22dc…79cabcb6` và `donation_escrow` `7ad64886…9df2f0be`; băm của mã
> hôm nay đọc ở trường `hash` trong `orilife_treasury/plutus.json` (sinh bằng `aiken build`),
> không chép lại đây.
>
> Bản thêm NFT sổ, hộp thư phí và đấu giá giảm dần đổi cả ba băm thêm một lần nữa (tham số
> mới: `seed`, `listing_window_ms`, `start_lovelace_per_carp`, `decay_ms`; hợp đồng mới
> `fee_inbox`). Băm đổi ⟹ địa chỉ đổi, nên bản hiện tại CHƯA từng được deploy và chưa có địa
> chỉ nào để ghi. Giữ nguyên địa chỉ cũ ở đây là cố ý: sửa chúng thành địa chỉ suy từ mã hôm nay là
> trỏ người đọc tới một chỗ trên chuỗi không có gì, và xoá mất con đường về số dư mà
> instance cũ còn giữ (xem mục `previous` trong `scripts/deployed_preprod.json`).

| Bước | Giao dịch | Khối | Ghi chú |
|---|---|---|---|
| mở kho | `d78775b0` | 5080008 | 5 tADA giữ chỗ, sổ 0/0 |
| nộp phí | `87bb1f79` | 5080013 | +1000 tCARP, `collected = 10¹²` |
| trích 10% | `05294e43` | 5080017 | 100 tCARP sang kho tạm, `skimmed = 10¹¹` |
| đổi + nộp | `f798ec08` | 5080019 | **`treasury_donation = 1.000.000` lovelace**, phí 1.913.199 |
| đóng kho | `e2cf1e27` | 5080021 | 5 tADA + 900 tCARP về ví; kho phí và kho tạm đều còn 0 UTxO |

**Giá thật của một lượt nộp, đo chứ không ước:** nộp 1,0 tADA vào kho bạc tốn 1,913199 tADA
phí. Trong đó 1,5 tADA là khoản bù tay (`FEE_SLACK`) mà `scripts/05` lúc ấy cộng thêm vì tưởng
bộ dựng tính phí khi chi phí thực thi còn bằng 0. Đo lại trên Emulator thì phí của bộ dựng ĐÃ gồm
giá ExUnits đã khai (2 M bộ nhớ, 900 M bước), nên khoản bù đó là thừa và đã bỏ khỏi `05`. Phần
còn lại (khoảng 0,41 tADA) mới là phí thật, trong đó phần ExUnits vẫn tính theo mức KHAI rộng
tay chứ không theo mức dùng thật. Ghi ra đây để không ai đọc "1,9 ADA phí" thành "hợp đồng nặng".

Instance CŨ (`addr_test1wrxmzy4qjv2a8urrk6fy36ek6336qu82h685wzad6deqauctrwv0c`, ghi trong
`deployed_preprod.json` mục `previous`) còn **5.000.000 lovelace + 900.000 tCARP**. tCARP thì
`Operate` rút ra được; **5 tADA thì không redeemer nào rút được** — đó chính là lỗ 4, và nó
nằm lại đó làm bằng chứng thay vì làm lời kể.

## Chi phí thực thi đo trên Emulator

Đo bằng `lifecycle_emulator.mjs` (phase-two trên giao dịch thật sắp nộp, không phải ước
lượng); số chạy lại được bất cứ lúc nào, bảng dưới là một lần chạy ngày 2026-10-03 (bản có
`operator_key` trong datum và `Rotate`). Trần mỗi giao dịch của Preprod là 14 M bộ nhớ / 10 G bước.

| Giao dịch | Redeemer | Bộ nhớ | Bước |
|---|---|---|---|
| mở kho | đúc NFT `Open` | 122 354 | 43 483 039 |
| mở kho | đăng ký credential hộp thư | 17 049 | 4 605 712 |
| gom 29 ô hộp thư + 2 ô lạc | ô sổ `Collect` | 1 518 263 | 511 642 871 |
| gom 29 ô hộp thư + 2 ô lạc | `withdraw` hộp thư (cả lô) | 1 143 722 | 378 332 339 |
| gom 29 ô hộp thư + 2 ô lạc | **cả giao dịch** (33 redeemer: 32 spend + 1 withdraw) | **6 704 120** | **2 979 500 282** |
| trích 10% | ô sổ `Skim` | 400 750 | 136 498 584 |
| đổi + nộp | ô kho tạm `Donate` | 165 242 | 59 792 207 |
| xoay khoá vận hành | ô sổ `Rotate` | 324 647 | 107 538 944 |
| đóng kho | ô sổ `Close` + đốt NFT | 177 640 + 33 494 | 57 079 870 + 10 235 544 |

Mỗi ô hộp thư tự nó rẻ (37 K → 147 K bộ nhớ, tăng dần theo vị trí trong giao dịch); phần nặng là
ô sổ và mỗi ô lạc, vì cả hai cộng CARP trên mọi đầu vào. Vì vậy `03` đặt trần riêng cho ô lạc (4)
thấp hơn trần ô hộp thư (30).

Bộ chạy đã được kiểm ngược bằng đột biến, mỗi đột biến cắm một dấu riêng, đếm dấu trước và sau:
- `requiredDonation` thiếu đúng 1 lovelace ⟹ `05` bị từ chối (`failed script execution`); đủ thì
  qua — công thức giá ngoài chuỗi khớp bản trên chuỗi tới từng lovelace.
- Bỏ bộ lọc datum trong `sweepable` ⟹ `03` nhặt ô mang băm datum không tiền ảnh và bộ chạy dừng
  ở kiểm phase-1. Chính đột biến này lộ ra một lỗi của bộ chạy: CML trả đối tượng bọc mới mỗi lần
  gọi `body.inputs()`, nên phép so đồng nhất luôn sai và kiểm phase-1 trước đó không kiểm gì.

## Ghi chú trung thực

- **`tCARP` là đồng THỬ, không phải CARP thật.** CARP thật chưa phát hành. Chính sách đúc ở
  đây là một chữ ký đơn. Tên `tCARP` nói thẳng điều đó thay vì để người đọc tự nhầm.
- **"Sàn giao dịch" trong bản thử là một địa chỉ ví đóng vai bên mua.** Hợp đồng không quan
  tâm CARP đi đâu — nó chỉ ràng buộc kho bạc phải nhận đủ. Ranh giới đó là cố ý: buộc một
  sàn cụ thể vào mã là buộc luôn rủi ro của sàn đó vào mã.
- **Giá mở và sàn là con số quản trị, không phải giá thị trường.** Chưa nối máng giá. Hệ quả
  phải nói ra: giá thị trường rơi xuống DƯỚI sàn thì `Donate` lỗ, không ai chạy, và CARP
  trong kho tạm nằm lại cho tới khi có người chịu nộp đủ sàn. Đó là fail-closed nghiêng về
  kho bạc — cố ý, nhưng nó là đóng băng, và người đọc phải biết trước. Đấu giá giảm dần chỉ
  thu lại phần chênh khi giá thị trường nằm GIỮA sàn và giá mở.
- **Gom có trần mỗi lượt, và chỉ nhặt ô gom được.** Hộp thư và địa chỉ kho là địa chỉ ai cũng gửi
  vào được, nên `03` không nhặt mù: chỉ ô CÓ CARP, không mang băm datum chưa giải được, không mang
  reference script; xếp CARP giảm dần; tối đa 30 ô hộp thư và 4 ô lạc. `03` bỏ qua ô chỉ-ADA và
  ô mang datum độc. Ô chỉ-ADA vẫn gom được nếu dựng tay kèm một `Collect` có `amount > 0`; ô mang
  băm datum không có tiền ảnh thì không ai tiêu được. Không hại gì, và `06` không để chúng chặn
  việc đóng kho.
- **Nguồn tự động của `collected` mới có một nửa.** Hộp thư nhận phí từ bất kỳ giao dịch nào
  trả CARP vào địa chỉ của nó, và ai cũng gom được. Phía ConsumeMAGIC chưa trả phí nền tảng
  vào địa chỉ hộp thư; tới lúc đó `03` vẫn tự nộp thay để thử tuyến.
- **Credential hộp thư phải được đăng ký trước lượt gom đầu tiên.** `02` làm việc đó (cọc theo
  tham số mạng). Hành vi của mặt `publish` trên chuỗi thật chưa được thử — chỉ mới qua
  phase-two trên Emulator.
- **`scripts/05` dựng giao dịch bằng thư viện tầng dưới, không qua bộ dựng thường.** Bộ dựng
  chạy thử hợp đồng trước khi trả về giao dịch, mà lúc đó trường nộp kho bạc chưa có nên hợp
  đồng từ chối — vòng lặp không thoát được. Lý do đầy đủ ghi trong đầu tệp đó.
- **Chưa dựng giao dịch tấn công THẬT trên chuỗi.** Lỗ 1 được chứng minh bằng bài kiểm cấp
  validator cộng đột biến (gỡ hàng rào ⟹ đúng bài kiểm đó đỏ), không phải bằng một giao dịch
  bị nút mạng từ chối. Khác biệt đó có thật, ghi ra thay vì để dấu xanh tự nói.

OriLife agent
