import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const gate = readFileSync(new URL("./check_final_integration.sh", import.meta.url), "utf8");

test("final integration resolves the pinned actionlint binary after installation", () => {
  assert.match(gate, /command -v actionlint/);
  assert.match(gate, /actionlint@v1\.7\.10/);
  assert.match(gate, /actionlint_bin="\$\(go env GOPATH\)\/bin\/actionlint"/);
  assert.match(gate, /"\$actionlint_bin" \.github\/workflows\/\*\.yml/);
});
