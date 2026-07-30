#!/usr/bin/env bash
# Tái dựng blueprint custody từ nguồn LAMP/Treasury/onchain HIỆN TẠI vào vendor/.
#
# Vì sao cần: plutus.json committed trong LAMP/Treasury/onchain đang STALE (build trước khi
# thêm params proposal_policy/ms_per_epoch vào custody.ak) → applyParamsToScript over-apply.
# Script này copy nguồn sang thư mục tạm, `aiken build`, lấy plutus.json TƯƠI (có params),
# KHÔNG ghi vào repo LAMP. Cần `aiken` trong PATH (v1.1.x).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SRC="/Users/ductiger/Projects/LAMP/Treasury/onchain"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if ! command -v aiken >/dev/null 2>&1; then
  echo "❌ thiếu 'aiken' trong PATH (cần v1.1.x). Cài: https://aiken-lang.org" >&2
  exit 1
fi

cp -r "$SRC"/aiken.toml "$SRC"/lib "$SRC"/validators "$TMP"/
[ -f "$SRC/aiken.lock" ] && cp "$SRC/aiken.lock" "$TMP"/ || true

( cd "$TMP" && aiken build )

cp "$TMP/plutus.json" "$ROOT/vendor/treasury-custody.plutus.json"
echo "✅ vendor/treasury-custody.plutus.json đã cập nhật từ $SRC"
