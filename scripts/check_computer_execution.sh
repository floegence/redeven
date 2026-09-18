#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
temporary="$(mktemp -d "${TMPDIR:-/tmp}/redeven-computer-check.XXXXXX")"
trap 'rm -rf -- "$temporary"' EXIT

# These fixtures use disposable browser profiles and private input channels.
# They never attach to a daily browser or inject input into the host desktop.
GOWORK=off go build -o "$temporary/redeven" ./cmd/redeven
REDEVEN_BROWSER_BRIDGE_BINARY="$temporary/redeven" node --test \
  internal/envapp/ui_src/scripts/computerScript.node-test.mjs \
  internal/envapp/ui_src/scripts/computerBrowser.node-test.mjs \
  internal/envapp/ui_src/scripts/computerManagedSandbox.node-test.mjs \
  internal/envapp/ui_src/scripts/computerPopup.node-test.mjs \
  internal/envapp/ui_src/scripts/computerExtensionLifecycle.node-test.mjs \
  internal/envapp/ui_src/scripts/computerExtension.node-test.mjs \
  internal/envapp/ui_src/scripts/computerNativeMessaging.node-test.mjs
REDEVEN_BROWSER_INTEGRATION=1 GOWORK=off go test ./internal/ai \
  -run '^TestManagedBrowser|^TestComputerPartialErrorAndUnknownOutcome' -count=1
node scripts/check_computer_host_safety.mjs
node --test scripts/computer_benchmark_report.test.mjs
REDEVEN_COMPUTER_BUNDLE_QUALIFICATION=1 node --test scripts/stage_computer_resources.test.mjs
if [[ "$(uname -s)" == Darwin ]]; then
  swift test --package-path desktop/native/computer-host
  swift build -c release --package-path desktop/native/computer-host
  node scripts/check_macos_computer_protocol.mjs desktop/native/computer-host/.build/release/redeven-computer-host
fi

# The foreground macOS fixture and paired online benchmark remain explicit
# qualification runs; they require an unlocked desktop and model credentials.
