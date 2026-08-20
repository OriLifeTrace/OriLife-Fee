//// Hai phép chia nguyên, tách riêng ra để chỗ làm tròn nhìn thấy được.

/// Chia nguyên làm tròn XUỐNG. Dùng cho phần được phép lấy.
pub fn floor_div(numerator: Int, denominator: Int) -> Int {
  numerator / denominator
}

/// Chia nguyên làm tròn LÊN. Dùng cho phần phải trả.
///
/// Vì sao hai hàm chứ không một: mỗi phép làm tròn đều lệch về một phía, và nếu để
/// mặc định thì nó luôn lệch về phía người giữ tiền. Ở đây nghĩa vụ làm tròn lên và
/// quyền lợi làm tròn xuống, nên mọi sai số một-đơn-vị đều rơi về phía kho bạc.
pub fn ceil_div(numerator: Int, denominator: Int) -> Int {
  ( numerator + denominator - 1 ) / denominator
}
