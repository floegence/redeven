---
type: Validation Guide
title: Host application input validation
tags: [applications, input, linux, macos, validation]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

Real app receipts/saved bytes qualify client input, not dispatch or DOM focus. Upstream owns native/Xpra; Redeven verifies viewer/transport/launch/recovery and preserves existing resources. Simulated events cannot certify system candidates or physical mobile input.

# Contract

Published native 0.22.19/Floe core 0.86.0/GOWORK=off:Linux maps physical keys to the seat, uses confirmed Unicode for unrepresentable layouts, and orders clipboard publication before paste upstream. Never paste stale selections, replay text or release composition after scroll.

Set REDEVEN_TEST_DESKTOP_COMPONENT_STATE to the task-owned released combined root; independently confirm received string. Missing CJK/emoji fonts do not invalidate exact receipts or qualify visible glyphs. TestInstalledDesktopApplicationTransport verifies pointer/text/keys/saved bytes, rejects invalid clipboard/cancels dependent input, recreates manager and saves through the same helper. Unknown records fail read-only; the old 40 s boundary cannot terminate a live first-window wait.

# Boundaries

## macOS and physical-device boundary
The native Mac helper remains the platform authority. Shared canvas extraction requires macOS viewer/input, first-frame, toolbar, reconnect and stale-target regression tests as well as actual fixture input.

Browser composition and touch event injection prove transport and application behavior only.

# Evidence

- `internal/hostapps/desktop_installed_test.go`: real native input, saved bytes, clipboard failure and manager replacement.

- `internal/hostapps/package_installed_test.go` and `scripts/host_application_native_acceptance.mjs`: installed packages and actual editor saves.

- `internal/hostapps/client_input_test.go` and `scripts/check_host_application_input.mjs`: isolated product viewer and browser receipts.
