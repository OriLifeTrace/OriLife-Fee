//// Phép chia nguyên của hợp đồng, tách riêng ra để chỗ làm tròn nhìn thấy được.

/// Chia nguyên làm tròn LÊN.
///
/// Mỗi phép làm tròn đều lệch về một phía, và nếu để mặc định (`/` của Aiken làm tròn
/// xuống) thì nó luôn lệch về phía người giữ tiền. Nghĩa vụ nộp kho bạc làm tròn LÊN,
/// nên mọi sai số một-đơn-vị đều rơi về phía kho bạc.
///
/// Bản trước của tệp này có thêm `floor_div` và một đoạn chú thích hứa đúng câu trên —
/// trong khi `fee_vault.ak` lại dùng `floor_div` cho CẢ nghĩa vụ lẫn trần được trích.
/// Chú thích nói một đằng, mã làm một nẻo, và không bài kiểm nào đỏ vì nó. Nay chỉ còn
/// MỘT hàm, nên không còn chỗ để hai thứ đó lệch nhau.
///
/// Trần được trích cũng phải làm tròn LÊN cùng chiều với nghĩa vụ. Nếu trần làm tròn
/// xuống mà nghĩa vụ làm tròn lên thì phần chênh không bao giờ trích hết được, và kho
/// vĩnh viễn không đóng lại được vì `Close` đòi nghĩa vụ về 0.
pub fn ceil_div(numerator: Int, denominator: Int) -> Int {
  ( numerator + denominator - 1 ) / denominator
}
