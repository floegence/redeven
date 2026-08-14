import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("every shipped Redeven runtime enables the published native Floeterm engine", () => {
  const release = source(".github/workflows/release.yml");
  const desktopBundle = source("scripts/build_desktop_bundled_runtime.sh");
  const sshSourceBuild = source("desktop/src/main/runtimePackageCache.ts");
  const finalGate = source("scripts/check_final_integration.sh");
  const carrier = source("internal/envapp/ui_src/scripts/checkSemanticTerminalCarrier.mjs");

  assert.match(release, /- goos: darwin\n\s+goarch: amd64\n\s+runner: macos-15-intel/u);
  assert.match(release, /- goos: darwin\n\s+goarch: arm64\n\s+runner: macos-15/u);
  assert.match(release, /CGO_ENABLED: 1/u);
  assert.equal((release.match(/-tags floeterm_native/gu) ?? []).length, 2);

  assert.match(desktopBundle, /CGO_ENABLED=1 \\\n\s+go build \\\n\s+-tags floeterm_native/u);
  assert.doesNotMatch(desktopBundle, /CGO_ENABLED="\$\{CGO_ENABLED:-0\}"/u);

  assert.match(sshSourceBuild, /'build',\n\s+'-tags',\n\s+'floeterm_native'/u);
  assert.match(sshSourceBuild, /CGO_ENABLED: '1'/u);

  assert.match(finalGate, /go test -tags floeterm_native -p 1 -count=1 \.\/\.\.\./u);
  assert.match(finalGate, /golangci-lint run --build-tags floeterm_native \.\/\.\.\./u);
  assert.match(finalGate, /TestTerminalLiveStreamFailsClosedWithoutNativeActor/u);

  assert.match(carrier, /\['build', '-tags', 'floeterm_native'/u);
  assert.match(carrier, /CGO_ENABLED: '1'/u);
});
