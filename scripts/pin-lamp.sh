#!/usr/bin/env bash
# Dựng `vendor/lamp` — bản LAMP GHIM ĐÚNG MỘT COMMIT mà kho này biên dịch được.
#
# Vì sao phải ghim, và vì sao đây là tệp thay cho `rebuild-blueprint.sh` cũ:
#
# Kho này nhập thẳng bộ dựng giao dịch của LAMP Treasury. Trước đây đường nhập là
# `../../../LAMP/...` — tức là biên dịch với BẤT KỲ commit nào LAMP đang ở trên đĩa người chạy.
# LAMP đổi giao diện `custody` từ 2 sang 3 tham số ngày 15/06 (`8e485b3`), nên từ hôm đó kho này
# đỏ trên mọi máy, mà thông điệp lỗi lại nói về `CollectParams` chứ không nói về commit.
#
# Ghim vào đâu, và vì sao đúng chỗ đó: `LAMP_PIN` dưới đây là commit CUỐI CÙNG còn khớp với
# blueprint trong `vendor/treasury-custody.plutus.json`, tức khớp với custody instance ĐÃ DỰNG
# trên Preview ở `scripts/deployed_preview.json`. Địa chỉ đó đang giữ tài sản thật (đo 20/08:
# 12 ADA, 19,5 triệu LAMP, 3 NFT). Biên dịch theo LAMP mới hơn là dựng giao dịch cho một script
# hash khác, tức là mất khả năng chi tiêu chỗ tài sản đó.
#
# Tệp cũ `rebuild-blueprint.sh` làm ngược lại: nó `cp` blueprint từ LAMP ở HEAD bất kỳ, ghi đè
# bản đang khớp, rồi THOÁT 0 như thể thành công. Nó đã bị xoá.
#
# Dùng:  ./scripts/pin-lamp.sh          (LAMP mặc định ở kho anh em cạnh thư mục này)
#        LAMP_REPO=/đường/dẫn/khác ./scripts/pin-lamp.sh
set -euo pipefail

LAMP_PIN="ebafc2e"                       # xem lý do ở phần đầu tệp
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
DEST="$ROOT/vendor/lamp"
LAMP_REPO="${LAMP_REPO:-$(cd "$ROOT/../.." && pwd)/LAMP}"

if [ ! -d "$LAMP_REPO/.git" ]; then
  echo "Không thấy kho LAMP ở '$LAMP_REPO'." >&2
  echo "Kho này biên dịch được lớp cầu nối chỉ khi có LAMP trên đĩa. Đặt LAMP_REPO trỏ đúng chỗ," >&2
  echo "hoặc bỏ qua bước này: phần lõi (feeEngine, bridge, buckets, tasks) không cần LAMP." >&2
  exit 2
fi

FULL="$(git -C "$LAMP_REPO" rev-parse --verify "${LAMP_PIN}^{commit}" 2>/dev/null || true)"
if [ -z "$FULL" ]; then
  echo "Kho LAMP ở '$LAMP_REPO' không có commit $LAMP_PIN — fetch rồi chạy lại." >&2
  exit 3
fi

if [ -e "$DEST" ]; then
  git -C "$LAMP_REPO" worktree remove --force "$DEST" 2>/dev/null || rm -rf "$DEST"
fi
git -C "$LAMP_REPO" worktree add --detach "$DEST" "$FULL" >/dev/null

GOT="$(git -C "$DEST" rev-parse HEAD)"
if [ "$GOT" != "$FULL" ]; then
  echo "Dựng xong nhưng commit không khớp: mong $FULL, được $GOT." >&2
  exit 4
fi
echo "vendor/lamp đã ghim ở $LAMP_PIN ($GOT)."
