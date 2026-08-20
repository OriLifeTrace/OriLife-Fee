import { defineConfig } from "vitest/config";

// Bài kiểm của kho NÀY, không phải của kho khác.
//
// `vendor/lamp` là bản LAMP ghim commit, dựng bằng `scripts/pin-lamp.sh` (xem tệp đó). Nó mang
// theo bộ kiểm của chính LAMP. Để mặc thì `vitest` gom cả hai bộ vào một con số, và cổng chất
// lượng của kho này sẽ xanh hay đỏ theo mã của kho khác — cùng lúc che mất số bài kiểm thật của
// mình. Loại nó ra ở đây, không loại ở dòng lệnh, để mọi người chạy đều được cùng một con số.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "e2e/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "vendor/**"],
  },
});
