//// Kiểu dữ liệu dùng chung cho kho phí OriLife.
////
//// Đơn vị CARP ở đây luôn là đơn vị nhỏ nhất trên chuỗi (`nanothread`, tức CARP × 10⁹).
//// Không có số thực nào trong hợp đồng: mọi phép chia đều là chia nguyên, và chỗ nào
//// làm tròn thì làm tròn LÊN về phía nghĩa vụ, không về phía người giữ tiền.

use cardano/address.{Credential}
use cardano/assets.{AssetName}
use cardano/transaction.{OutputReference}

/// Tên NFT định danh ô sổ kho phí. Policy của nó là băm chính script kho phí, và chỉ đúc
/// được một lần (`seed` bị tiêu khi mở kho), nên "ô ở địa chỉ kho giữ NFT này" là cách
/// DUY NHẤT nhận ra sổ thật. Địa chỉ thì không nhận ra được: ai cũng gửi được một UTxO
/// mang datum tự đặt tới địa chỉ kho. Kho phí, `fee_inbox` và kịch bản ngoài chuỗi dùng
/// chung đúng chuỗi byte này (hex `6f72696c6966652d6665652d7661756c74`).
pub const vault_nft_name: AssetName = "orilife-fee-vault"

/// Trạng thái kho phí. Hai con số đầu là toàn bộ lời khai kế toán của kho, và ai cũng đọc
/// được chúng trực tiếp từ UTxO — không phải hỏi máy chủ nào.
///
/// `collected` chỉ tăng, `skimmed` chỉ tăng, và `skimmed` không bao giờ vượt phần
/// nghĩa vụ tính trên `collected`. Ba câu đó là toàn bộ cơ chế bảo đảm lời hứa 10%.
pub type VaultDatum {
  /// Tổng CARP đã từng chảy vào kho, cộng dồn từ đầu. KHÔNG phải số dư hiện tại.
  collected: Int,
  /// Tổng CARP đã chuyển sang kho tạm chờ đổi ADA. Cũng cộng dồn.
  skimmed: Int,
  /// Băm khoá vận hành OriLife (verification key hash). Cần cho `Operate`, `Rotate`,
  /// `Close`; nộp phí và trích nghĩa vụ thì ai cũng gọi được.
  ///
  /// Vì sao nằm trong datum chứ không là tham số biên dịch: tham số thì đổi khoá là đổi băm
  /// kho, tức phải `Close` instance cũ — mà `Close` đốt NFT sổ, và `fee_inbox` bake băm kho
  /// đó: mọi ô CARP còn trong hộp thư mất đường vào sổ vĩnh viễn. Trong datum thì `Rotate`
  /// đổi khoá tại chỗ, băm kho và NFT giữ nguyên, hộp thư vẫn gom được.
  operator_key: ByteArray,
}

pub type VaultRedeemer {
  /// Nộp phí vào kho. Ai cũng gọi được — kho không cần biết người nộp là ai, nó chỉ
  /// cần giá trị vào đúng bằng con số khai trong `amount`.
  Collect { amount: Int }
  /// Trích phần nghĩa vụ sang kho tạm. Không được trích quá phần nghĩa vụ.
  Skim { amount: Int }
  /// Chi tiêu phần vận hành. Đây là chỗ DUY NHẤT tiền rời kho mà không sang kho tạm,
  /// nên đây cũng là chỗ duy nhất cần chặn.
  Operate
  /// Đóng kho. Chỉ được khi nghĩa vụ đã trả hết; sau đó UTxO kho không còn tồn tại.
  ///
  /// Vì sao phải có: không có nó thì ADA giữ chỗ nằm lại vĩnh viễn (mọi nhánh khác đều
  /// ép `lovelace_of(ra) >= lovelace_of(vào)`, tức ADA chỉ có đường vào).
  ///
  /// `Close` là TẮT VĨNH VIỄN, không phải đường xoay khoá (xoay khoá là `Rotate`). NFT sổ
  /// bị đốt, nên mọi ô CARP còn ở hộp thư (`fee_inbox`) trỏ về kho này không còn đường vào
  /// sổ. Hợp đồng không chặn được việc đó: ô hộp thư không nằm trong giao dịch đóng kho, và
  /// validator không thấy UTxO ngoài giao dịch. Trước khi đóng phải gom hết hộp thư.
  Close
  /// Xoay khoá vận hành. Ô sổ đi ra giữ nguyên địa chỉ, giá trị (kể cả NFT), `collected`,
  /// `skimmed`; chỉ `operator_key` đổi. Cần chữ ký của khoá HIỆN TẠI (trong datum đầu vào)
  /// VÀ của khoá MỚI — khoá mới không ký được thì không ai còn gọi được `Operate`/`Close`.
  /// Đặt CUỐI để không đổi chỉ số constructor của bốn nhánh đã có.
  Rotate
}

/// Mặt đúc của kho phí. Chỉ có hai việc: đúc NFT sổ khi mở kho, đốt nó khi đóng kho.
pub type VaultMint {
  /// Mở kho: tiêu `seed`, đúc đúng một NFT vào một ô sổ trắng, khoá vận hành trong datum
  /// phải ký.
  Open
  /// Đốt NFT. Đường duy nhất tới đây là `Close` — mọi nhánh spend khác đòi ô sổ đi ra
  /// giữ NFT.
  Burn
}

/// Kho tạm giữ phần đã trích. Tiền ở đây chỉ có một lối ra: một giao dịch có nộp
/// kho bạc Cardano.
pub type EscrowDatum {
  /// Số CARP mà UTxO này đang giữ. Khai tường minh để người đọc không phải suy từ
  /// giá trị kèm theo, và để hợp đồng bắt được trường hợp khai lệch.
  carp: Int,
  /// Băm hợp đồng kho phí đã trích khoản này ra.
  ///
  /// Vì sao cần: `list.length(own_inputs) == 1` bên kho phí chỉ đếm input CÙNG băm
  /// script. Hai instance kho phí khác tham số có băm khác nhau, nên mỗi cái tự thấy
  /// mình là input duy nhất, và MỘT output ở kho tạm thoả điều kiện cho CẢ HAI — hai
  /// lần `skimmed` tăng mà chỉ một lần CARP rời kho. Ràng khoản trích vào đúng một băm
  /// kho phí là chỗ chặn việc đó.
  vault: ByteArray,
  /// Ô đầu vào mà UTxO này là phần dư của. `None` nghĩa là khoản vừa được trích sang,
  /// chưa từng bị tiêu.
  ///
  /// Vì sao cần: kho tạm đo phần đã rời đi bằng `giữ − trả_lại`, và trước đây `trả_lại`
  /// là TỔNG mọi output ở địa chỉ mình. Bộ lọc đó không phân biệt phần dư của chính
  /// mình với tiền MỚI vừa được gửi vào trong cùng giao dịch, nên ghép `Skim` và
  /// `Donate` vào một giao dịch là `trả_lại` phình lên và nghĩa vụ bốc hơi. Có trường
  /// này thì phần dư tự khai mình là phần dư của ô nào.
  parent: Option<OutputReference>,
  /// Mốc POSIX (ms) phiên đấu giá giảm dần của khoản này bắt đầu: tới mốc này giá còn ở
  /// trần, sau đó hạ tuyến tính về sàn trong `decay_ms`.
  ///
  /// Vì sao cần: trả đúng sàn ở mọi thời điểm là trao cho người gọi `Donate` một quyền
  /// chọn miễn phí — họ lấy CARP theo sàn và bỏ túi chênh lệch tới giá thị trường. Kho
  /// phí ép mốc này bằng cận trên khoảng hiệu lực của giao dịch `Skim` (không lùi ngày
  /// được để mua rẻ ngay), và phần dư giữ nguyên mốc của ô gốc (không đặt lại được).
  listed_at: Int,
}

pub type EscrowRedeemer {
  /// Đổi CARP lấy ADA rồi nộp kho bạc. Ai cũng gọi được — cố ý: nếu OriLife biến mất
  /// thì lời hứa vẫn thực thi được bởi người ngoài.
  Donate
}

/// Datum tuỳ chọn của một ô hộp thư phí (`fee_inbox`): địa chỉ hoàn khoản min-ADA.
///
/// Bên trả phí không có ADA (nông dân) thì bên ứng phí (Feecover) nộp hộ min-ADA cho ô hộp
/// thư. Ô mang datum này ⟹ khi gom, lovelace của ô trừ `refund_fee` phải về `refund`; người
/// gom chỉ giữ `refund_fee`. Ô không datum (hoặc datum sai hình) ⟹ lovelace là phần thưởng
/// người gom như cũ. Trên chuỗi: `Constr 0 [refund]`.
pub type InboxDatum {
  /// Payment credential nhận hoàn. Đầu ra hoàn chỉ cần khớp phần này; phần uỷ quyền và
  /// datum của đầu ra tự do. Là `Script` thì đầu ra hoàn tới script đó KHÔNG có datum —
  /// script đó phải tiêu được ô không datum; đó là việc của bên giữ script, không phải
  /// của hộp thư.
  refund: Credential,
}
