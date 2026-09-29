import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

for (const goos of ["darwin", "linux"]) {
  for (const goarch of ["amd64", "arm64"]) {
    test(`release build passes exact ${goos}/${goarch} arguments through the system Bash`, () => {
      const block = source(".github/workflows/release.yml").match(
        /      - name: Build binaries\n[\s\S]*?\n        run: \|\n([\s\S]*?)(?=\n      - name:)/u,
      );
      assert.ok(block, "release runtime build step must exist");
      const script = block[1].split("\n").map((line) => line.slice(10)).join("\n");
      const root = realpathSync(mkdtempSync(join(tmpdir(), "redeven release build ")));
      try {
        mkdirSync(join(root, "scripts"));
        const capture = join(root, "arguments");
        writeFileSync(join(root, "scripts/build_runtime_binary.sh"), [
          "#!/bin/sh",
          "set -eu",
          'printf "%s\\0" "$@" >> "$RELEASE_BUILD_ARGS"',
          'printf "__END_CALL__\\0" >> "$RELEASE_BUILD_ARGS"',
          "",
        ].join("\n"), { mode: 0o755 });
        const commit = "1234567890abcdef1234567890abcdef12345678";
        const result = spawnSync("/bin/bash", ["-c", script], {
          cwd: root,
          env: { ...process.env, GOOS: goos, GOARCH: goarch, GITHUB_REF_NAME: "v0.13.1", GITHUB_SHA: commit, RELEASE_BUILD_ARGS: capture },
          encoding: "utf8",
        });
        assert.equal(result.status, 0, result.stderr);
        const calls = readFileSync(capture, "utf8").split("__END_CALL__\0");
        assert.equal(calls.pop(), "");
        assert.equal(calls.length, 2);
        for (const [index, binary] of ["redeven", "redeven-gateway"].entries()) {
          const args = calls[index].split("\0");
          assert.equal(args.pop(), "");
          assert.match(args[13], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u);
          assert.deepEqual(args, [
            "--goos", goos, "--goarch", goarch,
            "--output", `dist/${binary}`, "--command", `./cmd/${binary}`,
            "--version", "v0.13.1", "--commit", commit.slice(0, 12),
            "--build-time", args[13],
            ...(goos === "linux" ? ["--relink-dir", `${root}/dist/runtime-relink/${binary}`] : []),
          ]);
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
}

test("every shipped Redeven runtime enables the published native Floeterm engine", () => {
  const release = source(".github/workflows/release.yml");
  const desktopBundle = source("scripts/build_desktop_bundled_runtime.sh");
  const runtimeBuilder = source("scripts/build_runtime_binary.sh");
  const sshSourceBuild = source("desktop/src/main/runtimePackageCache.ts");
  const finalGate = source("scripts/check_final_integration.sh");
  const carrier = source("internal/envapp/ui_src/scripts/checkSemanticTerminalCarrier.mjs");

  assert.match(release, /- goos: darwin\n\s+goarch: amd64\n\s+runner: macos-15-intel/u);
  assert.match(release, /- goos: darwin\n\s+goarch: arm64\n\s+runner: macos-15/u);
  assert.match(release, /CGO_ENABLED: 1/u);
  assert.match(release, /build_runtime_binary\.sh/u);
  assert.match(release, /for binary in redeven redeven-gateway/u);
  assert.match(release, /readelf -l/u);
  assert.match(release, /readelf -d/u);

  assert.match(desktopBundle, /build_runtime_binary\.sh/u);
  assert.doesNotMatch(desktopBundle, /CGO_ENABLED="\$\{CGO_ENABLED:-0\}"/u);

  assert.match(sshSourceBuild, /build_runtime_binary\.sh/u);
  assert.match(runtimeBuilder, /"CGO_ENABLED=1"/u);
  assert.match(runtimeBuilder, /build_tags="floeterm_native"/u);
  assert.match(runtimeBuilder, /build_tags\+=",netgo,osusergo"/u);
  assert.match(runtimeBuilder, /-linkmode external -extldflags '-static -lrt -lpthread'/u);
  assert.match(runtimeBuilder, /linux\/amd64\) target_cpu="x86_64"/u);
  assert.match(runtimeBuilder, /linux\/arm64\) target_cpu="aarch64"/u);
  assert.match(runtimeBuilder, /GNU C and C\+\+ compilers are required/u);

  assert.match(finalGate, /floeterm_native_build_contract\.test\.mjs/u);
  assert.doesNotMatch(finalGate, /go test -tags floeterm_native -p 1 -count=1 \.\/\.\.\./u);
  assert.doesNotMatch(finalGate, /golangci-lint run --build-tags floeterm_native \.\/\.\.\./u);

  assert.match(carrier, /\['build', '-tags', 'floeterm_native'/u);
  assert.match(carrier, /CGO_ENABLED: '1'/u);
});
