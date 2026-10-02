---
type: Validation Guide
title: Current-desktop acceptance method
description: Qualify remote desktop contracts, office interaction and actual painted performance without substituting synthetic checks.
tags: [desktop, linux, macos, validation, performance]
timestamp: 2026-10-02T03:00:00Z
---
# Summary

This guide defines acceptance for the [desktop contract](../architecture/remote-desktop.md).
Use published dependencies with `GOWORK=off`, preserve failed measurements and
resolve unmet thresholds before integration. A connected picture, native input
admission or a synthetic fixture does not certify real desktop performance.
The [acceptance record](remote-desktop-results.md) owns measured results and
remaining qualification.

# Performance Contract

At both 1920x1080 and 2560x1440, measure scrolling and task-owned window motion
for at least 60 seconds, three times each, on a documented low-latency connection.
Each run requires actual painted FPS >=55 and frame interval P95 <=33ms.
Physical input to changed client presentation requires P95 <=80ms; server input
admission and packet arrival are not visible response.

Refinement must finish within 500ms and match a lossless text reference at the
same dimensions after host motion stops. Verify original-pixel coordinates and
text separately. Compare the actual PNG draw after its paint receipt with the
independent reference. After capture reconfiguration, require the new generation's
paint receipt and matching snapshot dimensions. Retain later video draws separately so asynchronous
screenshot timing cannot substitute a lossy frame for the refinement.
Ten-minute interaction requires bounded queues, released keys
and no accumulated audiovisual delay. Record encoder, decoder preference,
CPU/GPU attribution, bandwidth and failures. Whole-device GPU counters cannot
be attributed to the remote desktop process. 4K does not substitute for either
required resolution.

# Real-Host Boundaries

The host user completes OS authorization. Fixtures operate only their own
applications and stop input on foreground loss. Before each physical-input
sample, wait for current paint authority and focus; record recovery transitions
and never replay a key whose delivery is unknown. Display leases restore the
original mode; cleanup preserves user applications and unsaved work.

Verify office text, Chinese input, explicit paste, pointer drag, scrolling,
shortcuts, bidirectional clipboard, audio, full screen, display selection,
application/desktop takeover and reconnect on both macOS and Linux. Lock
refusal is paused sharing, never successful remote unlocking. Runtime restart
invalidates credentials and requires a new product session; transport reconnect
does not recreate an expired session.

Audio capture, decoding and AudioWorklet acknowledgement prove only the observed
handoff. They do not prove that a physical output device played the samples or
that audiovisual delay remained bounded. Preserve that distinction in results.
Credentials and raw captures remain outside the repository and audit payloads.

# Focused Verification

Run affected `GOWORK=off go test -race` checks for `internal/remotedesktop`,
`internal/codeapp/appserver`, `internal/hostapps`, `internal/config` and Local UI
access lifetime, plus Swift `HostApplicationHostTests`.

From `internal/envapp/ui_src`, run `node scripts/checkRemoteDesktopViewer.mjs`
and its `--electron` variant. These synthetic fixtures exercise production
viewer/preload behavior without controlling host applications. Electron requires
the official runtime and a unique profile/process marker.

The viewer checks cover input, clipboard, display removal, lock/permission
states, tickets, old-paint rejection, serialized transitions and view-only
clipboard cleanup. Declined takeover stays view-only. Initial `LOCKED` rejection
exposes reconnect without prior paint authority. Electron also checks native
full screen, Files and all ten locales at narrow width. These contract checks
cannot replace real-host or performance evidence.

# Evidence

- `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs` and `desktop/scripts/fixtures/remote-desktop.ts`: browser/Electron interaction fixtures.
- `internal/remotedesktop/socket_test.go` and `internal/remotedesktop/manager_test.go`: session and input authority checks.
- `internal/codeapp/appserver/remote_desktop_test.go`: API permissions and remembered-display persistence.
- `desktop/native/computer-host/Tests/RedevenComputerHostTests/HostApplicationHostTests.swift`: shared-helper channel and acquisition checks.
