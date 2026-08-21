import { defineConfig } from "vitest/config";

// THIS repository's tests, not another repository's.
//
// `vendor/lamp` is a pinned checkout of LAMP produced by `scripts/pin-lamp.sh` (see that file).
// It brings LAMP's own test suite with it. Left alone, `vitest` folds both suites into one number,
// so this repository's quality gate would go green or red according to somebody else's code —
// while hiding this repository's real test count. Excluded here rather than on the command line,
// so that everyone who runs it gets the same number.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "e2e/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "vendor/**"],
  },
});
