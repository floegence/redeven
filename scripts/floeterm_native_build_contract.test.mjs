import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
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
  assert.equal((release.match(/-tags floeterm_native/gu) ?? []).length, 2);

  assert.match(desktopBundle, /build_runtime_binary\.sh/u);
  assert.doesNotMatch(desktopBundle, /CGO_ENABLED="\$\{CGO_ENABLED:-0\}"/u);

  assert.match(sshSourceBuild, /build_runtime_binary\.sh/u);
  assert.match(runtimeBuilder, /"CGO_ENABLED=1"/u);
  assert.match(runtimeBuilder, /-tags floeterm_native/u);
  assert.match(runtimeBuilder, /linux\/amd64\) zig_target="x86_64-linux-gnu"/u);
  assert.match(runtimeBuilder, /linux\/arm64\) zig_target="aarch64-linux-gnu"/u);
  assert.match(runtimeBuilder, /Zig is required to cross-compile/u);

  assert.match(finalGate, /go test -tags floeterm_native -p 1 -count=1 \.\/\.\.\./u);
  assert.match(finalGate, /golangci-lint run --build-tags floeterm_native \.\/\.\.\./u);
  assert.match(finalGate, /TestTerminalLiveStreamFailsClosedWithoutNativeActor/u);

  assert.match(carrier, /\['build', '-tags', 'floeterm_native'/u);
  assert.match(carrier, /CGO_ENABLED: '1'/u);
});
