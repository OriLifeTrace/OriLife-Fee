//// Kiểu dữ liệu dùng chung cho kho phí OriLife.
////
//// Đơn vị CARP ở đây luôn là đơn vị nhỏ nhất trên chuỗi (`nanothread`, tức CARP × 10⁹).
//// Không có số thực nào trong hợp đồng: mọi phép chia đều là chia nguyên, và chỗ nào
//// làm tròn thì làm tròn LÊN về phía nghĩa vụ, không về phía người giữ tiền.

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
}

/// Kho tạm giữ phần đã trích. Tiền ở đây chỉ có một lối ra: một giao dịch có nộp
/// kho bạc Cardano.
pub type EscrowDatum {
  /// Số CARP mà UTxO này đang giữ. Khai tường minh để người đọc không phải suy từ
  /// giá trị kèm theo, và để hợp đồng bắt được trường hợp khai lệch.
  carp: Int,
}

pub type EscrowRedeemer {
  /// Đổi CARP lấy ADA rồi nộp kho bạc. Ai cũng gọi được — cố ý: nếu OriLife biến mất
  /// thì lời hứa vẫn thực thi được bởi người ngoài.
  Donate
}
