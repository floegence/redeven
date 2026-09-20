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

function createFixture({ includeCompiler }) {
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
  if (includeCompiler) {
    for (const name of ["gcc", "g++", "x86_64-linux-gnu-gcc", "x86_64-linux-gnu-g++", "aarch64-unknown-linux-gnu-gcc", "aarch64-unknown-linux-gnu-g++"]) {
      writeExecutable(path.join(bin, name), "#!/bin/sh\nexit 0\n");
    }
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

test("cross-compiles a static Linux runtime with the matching GNU toolchain", () => {
  const fixture = createFixture({ includeCompiler: true });
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
    assert.match(log, /^CC=x86_64-linux-gnu-gcc$/mu);
    assert.match(log, /^CXX=x86_64-linux-gnu-g\+\+$/mu);
    assert.match(log, /^ARG=floeterm_native,netgo,osusergo$/mu);
    assert.match(log, /-linkmode external -extldflags '-static -lrt -lpthread'/u);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("keeps native Darwin builds free of Linux linker flags", () => {
  const fixture = createFixture({ includeCompiler: false });
  try {
    const result = runBuilder(fixture, {
      hostOS: "darwin",
      hostArch: "amd64",
      targetOS: "darwin",
      targetArch: "amd64",
    });

    assert.equal(result.status, 0, result.stderr);
    const log = readFileSync(fixture.log, "utf8");
    assert.match(log, /^CGO_ENABLED=1$/mu);
    assert.match(log, /^CC=$/mu);
    assert.match(log, /^CXX=$/mu);
    assert.match(log, /^ARG=floeterm_native$/mu);
    assert.doesNotMatch(log, /-static|netgo|osusergo/u);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

for (const target of [
  { hostOS: "linux", hostArch: "amd64", targetOS: "linux", targetArch: "amd64", compiler: "x86_64-linux-gnu-gcc" },
  { hostOS: "darwin", hostArch: "arm64", targetOS: "linux", targetArch: "arm64", compiler: "aarch64-unknown-linux-gnu-gcc" },
]) {
  test(`builds portable Linux ${target.targetArch} from ${target.hostOS} with native terminal support`, () => {
    const fixture = createFixture({ includeCompiler: true });
    try {
      const result = runBuilder(fixture, target);
      assert.equal(result.status, 0, result.stderr);
      const log = readFileSync(fixture.log, "utf8");
      assert.ok(log.includes(`CC=${target.compiler}\n`));
      assert.match(log, /^CGO_ENABLED=1$/mu);
      assert.match(log, /^ARG=floeterm_native,netgo,osusergo$/mu);
      assert.match(log, /-linkmode external -extldflags '-static -lrt -lpthread'/u);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}

test("fails before Go build when a cross-platform cgo target has no GNU toolchain", () => {
  const fixture = createFixture({ includeCompiler: false });
  try {
    const result = runBuilder(fixture, {
      hostOS: "darwin",
      hostArch: "arm64",
      targetOS: "linux",
      targetArch: "amd64",
      checkOnly: true,
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /GNU C and C\+\+ compilers are required for linux\/amd64/u);
    assert.throws(() => readFileSync(fixture.log, "utf8"), /ENOENT/u);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("preflight rejects a compiler without the target static libraries", () => {
  const fixture = createFixture({ includeCompiler: true });
  try {
    writeExecutable(path.join(fixture.bin, 'x86_64-linux-gnu-gcc'), '#!/bin/sh\nexit 1\n');
    const result = runBuilder(fixture, {
      hostOS: 'darwin', hostArch: 'arm64', targetOS: 'linux', targetArch: 'amd64', checkOnly: true,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /static GNU C\/C\+\+ libraries are required/u);
    assert.throws(() => readFileSync(fixture.log, 'utf8'), /ENOENT/u);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
