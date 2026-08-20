# Kho phí OriLife trên Cardano

Phí dịch vụ chảy vào bằng CARP. **10% dòng vào là nghĩa vụ phải nộp lại kho bạc Cardano**,
và nghĩa vụ đó do mã ép, không do quy trình vận hành.

## Vì sao ép được bằng mã

Từ kỷ nguyên Conway, thân giao dịch Cardano có trường `treasury_donation` — số lovelace mà
chính giao dịch này nộp thẳng vào kho bạc của mạng. Hợp đồng Plutus V3 đọc được trường đó.

Nên câu "10% quay về kho bạc" không còn là một lời hứa mà là **điều kiện chi tiêu**: kho tạm
giữ phần đã trích chỉ mở khoá trong một giao dịch có nộp đủ. Không nộp thì không tiêu được.

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
| `Skim { amount }` | bất kỳ ai | phần trích đi đúng về kho tạm, và không vượt nghĩa vụ |
| `Operate` | chỉ khoá vận hành | phần CARP còn lại phải **phủ được nghĩa vụ còn nợ** |

Câu chịu lực là dòng cuối. Hai dòng trên chỉ là kế toán — kế toán đúng mà tiền vẫn đi hết
thì vô nghĩa. Cơ chế không bảo đảm "sẽ nộp", nó bảo đảm **"không tiêu được phần phải nộp"**,
và đó là thứ mạnh hơn một lời hứa.

### `donation_escrow` — kho tạm

Một lối ra duy nhất: giao dịch phải nộp kho bạc ít nhất `số CARP rời đi × sàn tỉ giá`.

**Ai cũng gọi được, cố ý.** Bắt buộc chữ ký OriLife thì OriLife biến mất là lời hứa chết
theo. Đổi lại phải có sàn tỉ giá, nếu không người ngoài đổi giá bèo rồi bỏ túi chênh lệch.

Cho nộp làm nhiều đợt; phần quay lại kho tạm phải khai đúng số nó giữ.

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
```

Trạng thái đã triển khai ghi vào `scripts/deployed_preprod.json`; kịch bản đọc lại tệp đó
nên chạy lại không đúc thêm hay mở thêm kho.

## Ghi chú trung thực

- **`tCARP` là đồng THỬ, không phải CARP thật.** CARP thật chưa phát hành. Chính sách đúc ở
  đây là một chữ ký đơn. Tên `tCARP` nói thẳng điều đó thay vì để người đọc tự nhầm.
- **"Sàn giao dịch" trong bản thử là một địa chỉ ví đóng vai bên mua.** Hợp đồng không quan
  tâm CARP đi đâu — nó chỉ ràng buộc kho bạc phải nhận đủ. Ranh giới đó là cố ý: buộc một
  sàn cụ thể vào mã là buộc luôn rủi ro của sàn đó vào mã.
- **Sàn tỉ giá là con số quản trị chặn đáy, không phải giá thị trường.** Chưa nối máng giá.
  Nối máng giá thì đổi được sàn theo thị trường, nhưng cũng thêm một chỗ để tin.
- **`scripts/05` dựng giao dịch bằng thư viện tầng dưới, không qua bộ dựng thường.** Bộ dựng
  chạy thử hợp đồng trước khi trả về giao dịch, mà lúc đó trường nộp kho bạc chưa có nên hợp
  đồng từ chối — vòng lặp không thoát được. Lý do đầy đủ ghi trong đầu tệp đó.

OriLife agent
