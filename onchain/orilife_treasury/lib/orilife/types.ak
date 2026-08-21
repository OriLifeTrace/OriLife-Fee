//// Kiểu dữ liệu dùng chung cho kho phí OriLife.
////
//// Đơn vị CARP ở đây luôn là đơn vị nhỏ nhất trên chuỗi (`nanothread`, tức CARP × 10⁹).
//// Không có số thực nào trong hợp đồng: mọi phép chia đều là chia nguyên, và chỗ nào
//// làm tròn thì làm tròn LÊN về phía nghĩa vụ, không về phía người giữ tiền.

use cardano/transaction.{OutputReference}

/// Trạng thái kho phí. Hai con số này là toàn bộ lời khai của kho, và ai cũng đọc được
/// chúng trực tiếp từ UTxO — không phải hỏi máy chủ nào.
///
/// `collected` chỉ tăng, `skimmed` chỉ tăng, và `skimmed` không bao giờ vượt phần
/// nghĩa vụ tính trên `collected`. Ba câu đó là toàn bộ cơ chế bảo đảm lời hứa 10%.
pub type VaultDatum {
  /// Tổng CARP đã từng chảy vào kho, cộng dồn từ đầu. KHÔNG phải số dư hiện tại.
  collected: Int,
  /// Tổng CARP đã chuyển sang kho tạm chờ đổi ADA. Cũng cộng dồn.
  skimmed: Int,
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
  /// ép `lovelace_of(ra) >= lovelace_of(vào)`, tức ADA chỉ có đường vào), và `operator_key`
  /// là tham số biên dịch nên xoay khoá vận hành là phải dựng instance mới — mà instance
  /// cũ thì không đóng lại được. Đóng được kho là điều kiện để xoay khoá mà không bỏ của.
  Close
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
}

pub type EscrowRedeemer {
  /// Đổi CARP lấy ADA rồi nộp kho bạc. Ai cũng gọi được — cố ý: nếu OriLife biến mất
  /// thì lời hứa vẫn thực thi được bởi người ngoài.
  Donate
}
