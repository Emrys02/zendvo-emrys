/**
 * patch-jest-mock.js
 *
 * Polyfills `clearMocksOnScope` into jest-mock@29 so it is compatible with
 * jest-runtime@30, which calls this._moduleMocker.clearMocksOnScope(scope)
 * during module reset.
 *
 * This patch is idempotent — it is safe to run multiple times.
 * It runs automatically via the root package.json `postinstall` script.
 */

const fs = require("fs");
const path = require("path");

const JEST_MOCK_29_PATH = path.resolve(
  __dirname,
  "../node_modules/.pnpm/jest-mock@29.7.0/node_modules/jest-mock/build/index.js",
);

if (!fs.existsSync(JEST_MOCK_29_PATH)) {
  console.log("[patch-jest-mock] jest-mock@29 not found, skipping patch.");
  process.exit(0);
}

const src = fs.readFileSync(JEST_MOCK_29_PATH, "utf8");

if (src.includes("clearMocksOnScope")) {
  console.log("[patch-jest-mock] Already patched, nothing to do.");
  process.exit(0);
}

const PATCH = `  clearMocksOnScope(scope) {
    for (const key of Object.keys(scope)) {
      const value = scope[key];
      if (
        value != null &&
        (typeof value === 'object' || typeof value === 'function') &&
        '_isMockFunction' in value &&
        this.isMockFunction(value) &&
        typeof value.mockClear === 'function'
      ) {
        value.mockClear();
      }
    }
  }
`;

const patched = src.replace("  clearAllMocks() {", PATCH + "  clearAllMocks() {");

if (patched === src) {
  console.error("[patch-jest-mock] Could not find insertion point. Skipping.");
  process.exit(0);
}

fs.writeFileSync(JEST_MOCK_29_PATH, patched, "utf8");
console.log("[patch-jest-mock] jest-mock@29 patched successfully.");
