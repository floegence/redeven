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

  assert.match(finalGate, /go test -tags floeterm_native -p 1 -count=1 \.\/\.\.\./u);
  assert.match(finalGate, /golangci-lint run --build-tags floeterm_native \.\/\.\.\./u);
  assert.match(finalGate, /TestTerminalLiveStreamFailsClosedWithoutNativeActor/u);

  assert.match(carrier, /\['build', '-tags', 'floeterm_native'/u);
  assert.match(carrier, /CGO_ENABLED: '1'/u);
});
