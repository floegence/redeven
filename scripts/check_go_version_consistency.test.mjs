import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateRepository } from "./check_go_version_consistency.mjs";

function fixture({ readmeVersion = "1.27.0" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "redeven-go-version-"));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(join(root, "go.mod"), "module example.test/redeven\n\ngo 1.27.0\n");
  const workflow = "steps:\n  - uses: actions/setup-go@v6\n    with:\n      go-version-file: go.mod\n";
  writeFileSync(join(root, ".github/workflows/ci-check.yml"), workflow);
  writeFileSync(join(root, ".github/workflows/release.yml"), workflow);
  writeFileSync(
    join(root, "README.md"),
    `![Go](https://img.shields.io/badge/Go-${readmeVersion}-00ADD8)\n\n- Go \`${readmeVersion}\`\n`,
  );
  writeFileSync(
    join(root, "README.zh-CN.md"),
    `![Go](https://img.shields.io/badge/Go-${readmeVersion}-00ADD8)\n\n- Go \`${readmeVersion}\`\n`,
  );
  return root;
}

test("accepts one patch-level Go version across owned build sources", () => {
  assert.deepEqual(validateRepository(fixture(), { checkRuntime: false }), {
    errors: [],
    version: "1.27.0",
  });
});

test("rejects stale toolchain and README declarations", () => {
  const { errors } = validateRepository(
    fixture({ readmeVersion: "1.26.4" }),
    { checkRuntime: false },
  );
  assert.ok(errors.some((error) => error.includes("Go badge must declare 1.27.0")));
  assert.ok(errors.some((error) => error.includes("Go prerequisite must declare 1.27.0")));
});

test("rejects setup-go steps that bypass go.mod", () => {
  const root = fixture();
  writeFileSync(
    join(root, ".github/workflows/ci-check.yml"),
    "steps:\n  - uses: actions/setup-go@v6\n    with:\n      go-version: 1.26.4\n",
  );
  const { errors } = validateRepository(root, { checkRuntime: false });
  assert.ok(errors.some((error) => error.includes("go-version-file: go.mod")));
});
