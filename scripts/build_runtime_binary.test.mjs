import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const builder = path.join(repositoryRoot, "scripts", "build_runtime_binary.sh");

function writeExecutable(pathname, source) {
  writeFileSync(pathname, source);
  chmodSync(pathname, 0o755);
}

function createFixture({ includeZig }) {
  const root = mkdtempSync(path.join(tmpdir(), "redeven-runtime-builder-test-"));
  const bin = path.join(root, "bin");
  const log = path.join(root, "go-build.log");
  const output = path.join(root, "out", "redeven");
  writeFileSync(path.join(root, ".keep"), "");
  mkdirSync(bin, { recursive: true });
  writeExecutable(path.join(bin, "go"), `#!/bin/sh
set -eu
if [ "\${1:-}" = "env" ] && [ "\${2:-}" = "GOHOSTOS" ]; then
  printf '%s\\n' "$TEST_GOHOSTOS"
  exit 0
fi
if [ "\${1:-}" = "env" ] && [ "\${2:-}" = "GOHOSTARCH" ]; then
  printf '%s\\n' "$TEST_GOHOSTARCH"
  exit 0
fi
{
  printf 'GOWORK=%s\\n' "\${GOWORK:-}"
  printf 'GOOS=%s\\n' "\${GOOS:-}"
  printf 'GOARCH=%s\\n' "\${GOARCH:-}"
  printf 'CGO_ENABLED=%s\\n' "\${CGO_ENABLED:-}"
  printf 'CC=%s\\n' "\${CC:-}"
  printf 'CXX=%s\\n' "\${CXX:-}"
  printf 'ARG=%s\\n' "$@"
} > "$TEST_BUILD_LOG"
`);
  if (includeZig) {
    writeExecutable(path.join(bin, "zig"), "#!/bin/sh\nexit 0\n");
  }
  return { root, bin, log, output };
}

function runBuilder(fixture, { hostOS, hostArch, targetOS, targetArch, checkOnly = false }) {
  const args = [
    "--goos", targetOS,
    "--goarch", targetArch,
  ];
  if (checkOnly) {
    args.unshift("--check-only");
  } else {
    args.push(
      "--output", fixture.output,
      "--command", "./cmd/redeven",
      "--version", "v0.0.0-test",
      "--commit", "0123456789ab",
      "--build-time", "2026-08-16T00:00:00Z",
    );
  }
  return spawnSync(builder, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fixture.bin}:/usr/bin:/bin`,
      TEST_BUILD_LOG: fixture.log,
      TEST_GOHOSTOS: hostOS,
      TEST_GOHOSTARCH: hostArch,
    },
  });
}

test("cross-compiles Linux amd64 cgo with an explicit Zig GNU target", () => {
  const fixture = createFixture({ includeZig: true });
  try {
    const result = runBuilder(fixture, {
      hostOS: "darwin",
      hostArch: "arm64",
      targetOS: "linux",
      targetArch: "amd64",
    });

    assert.equal(result.status, 0, result.stderr);
    const log = readFileSync(fixture.log, "utf8");
    assert.match(log, /^GOWORK=off$/mu);
    assert.match(log, /^GOOS=linux$/mu);
    assert.match(log, /^GOARCH=amd64$/mu);
    assert.match(log, /^CGO_ENABLED=1$/mu);
    assert.match(log, /^CC=zig cc -target x86_64-linux-gnu$/mu);
    assert.match(log, /^CXX=zig c\+\+ -target x86_64-linux-gnu$/mu);
    assert.match(log, /^ARG=floeterm_native$/mu);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("uses the native C toolchain when host and target match", () => {
  const fixture = createFixture({ includeZig: false });
  try {
    const result = runBuilder(fixture, {
      hostOS: "linux",
      hostArch: "amd64",
      targetOS: "linux",
      targetArch: "amd64",
    });

    assert.equal(result.status, 0, result.stderr);
    const log = readFileSync(fixture.log, "utf8");
    assert.match(log, /^CGO_ENABLED=1$/mu);
    assert.match(log, /^CC=$/mu);
    assert.match(log, /^CXX=$/mu);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("fails before Go build when a cross-platform cgo target has no Zig compiler", () => {
  const fixture = createFixture({ includeZig: false });
  try {
    const result = runBuilder(fixture, {
      hostOS: "darwin",
      hostArch: "arm64",
      targetOS: "linux",
      targetArch: "amd64",
      checkOnly: true,
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Zig is required to cross-compile the linux\/amd64 cgo runtime from darwin\/arm64/u);
    assert.throws(() => readFileSync(fixture.log, "utf8"), /ENOENT/u);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
