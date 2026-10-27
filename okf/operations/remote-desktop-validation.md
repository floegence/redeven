---
type: Validation Guide
title: Current-desktop acceptance method
description: Qualify remote desktop contracts, office interaction and actual painted performance without substituting synthetic checks.
tags: [desktop, linux, macos, validation, performance]
timestamp: 2026-10-02T15:36:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

Qualify the desktop contract using published dependencies/GOWORK=off. Preserve failures and meet agreed-host thresholds before acceptance; integration, a picture, admitted input or synthetic fixture cannot substitute for real performance. The acceptance record owns measured results and remaining work.

# Contract

## Performance
At both 1920x1080 and 2560x1440, measure scrolling and task-owned window motion for at least 60 seconds, three times each, on a documented low-latency connection.

Refinement must finish within 500ms and match a lossless text reference at the same dimensions after host motion stops. 4K does not substitute for either required resolution.

# Boundaries

## Real-Host Qualification
For this delivery, the user explicitly designated `udesk24` as a functional-only GNOME Wayland environment on 2026-10-02 after its graphics limitations were measured.

Before each physical-input sample, wait for current paint authority and focus; record recovery transitions and never replay a key whose delivery is unknown.

Credentials and raw captures remain outside the repository and audit payloads.

## Focused Verification
Run affected `GOWORK=off go test -race` checks for `internal/remotedesktop`, `internal/codeapp/appserver`, `internal/hostapps`, `internal/config` and Local UI access lifetime, plus Swift `HostApplicationHostTests`.

These contract checks cannot replace real-host or performance evidence. This proves generation-scoped playback delivery, not acoustic output.

# Evidence

- `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs` and `desktop/scripts/fixtures/remote-desktop.ts`: browser/Electron interaction fixtures.

- `internal/remotedesktop/socket_test.go` and `internal/remotedesktop/manager_test.go`: session and input authority checks.

- `internal/codeapp/appserver/remote_desktop_test.go`: API permissions and remembered-display persistence.
