---
type: Validation Guide
title: Host application lifecycle acceptance
description: Scenario-based evidence for native application sharing and explicit recovery boundaries.
tags: [applications, macos, linux, validation]
timestamp: 2026-09-21T07:00:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

This matrix records observable lifecycle acceptance for Host Applications. The
[shared authorization contract](../architecture/host-applications.md) and
[macOS window lifecycle owner](../architecture/macos-application-window-lifecycle.md) remain normative.
A live process, an available window, a decoded frame and an authenticated viewer
are separate facts. Only explicit closure evidence ends the physical viewer.
A missing or inaccessible surface must preserve the app and provide an accurate
recovery path; it must never silently select an unrelated process or inject stale
input. This matrix is not a certification of every installed application.

See the [cross-platform behavior contract](../architecture/host-application-behavior.md)
for aligned operations and unavoidable OS differences.

# Contract

## Startup and window transitions
| Scenario | Expected outcome | Evidence |
| --- | --- | --- |
| Existing single-instance Mac app | Reuse its exact process; releasing a client lease preserves it | Real native fixture |
| First window delayed beyond 40 seconds | Keep waiting; display eventual pixels without relaunch | Real 48-second fixture, Go watchdog test |
| Multiple shareable windows | Visible counted picker, literal titles, current selection and direct switching; keep picker/focus during updates | Viewer and responsive browser tests |
| Close cancelled by app | Retain process and session; do not close viewer optimistically | Real close-cancellation fixture |
| Unreadable window list or replaced capture surface | Retain lifetime evidence; uncertainty never expires into closure | Swift inventory and presence tests |
| Linux application opens only a dialog | Reveal decoded dialog; retain its native dimensions | Xpra adapter test |
| Final window actually closes | Close established physical viewer | Native fixture and viewer tests |

| Scenario | Expected outcome | Evidence |
| --- | --- | --- |
| Last client lease released for a newly launched app | End only sharing; keep all native windows and process alive | Real multiple-window quit fixture |
| One selected instance is stale | Reject the entire selection before any termination request | Real quit fixture |
| App cancels quit | Preserve process, pixels and active sharing; allow another explicit request | Real cancellation and reconnect fixture |
| Request outcome unknown | Keep an error in the confirmation; never infer exit or retry automatically | Env App interaction test |
| Read-only caller | Running list is readable; quit and detach are forbidden | API permission and Env App tests |

| Scenario | Expected outcome | Evidence |
| --- | --- | --- |
| Network loss or viewer reload | Preserve app; suspend native capture/input, reclaim frame buffers, then reconnect the same session with current credential | Go WebSocket, native startup fixture and viewer tests |
| Second viewer attaches | Revoke previous input connection, release held input, suspend the old capture and let the new viewer resume it | Go WebSocket replacement and native startup fixture |
| Permission revoked or console locked | Invalidate capture/input and show a distinct recovery action | Swift access classification and viewer event tests |
| Helper unexpectedly exits | Sharing failure, not proof of application exit; reclaim route, credential, frame buffers and helper process before terminal state | Go helper and viewer tests |
| Late callback or unknown terminal reason | Ignore stale results; retain the terminal page without automatic physical closure | macOS/Xpra viewer tests |
| Input cannot prove foreground/window ownership | Nonblocking failure; no replay into another app | Native input fixture and viewer operation tests |
| Video decoder unavailable | Negotiate image transport for the same process | Existing picture/viewer acceptance |

The viewer toolbar acceptance also covers content-area resizing below the fixed bar, bounded popovers at 320/390/1000 pixels, native-menu keyboard navigation, separate window close and confirmed application quit, late menu dismissal, and unconfirmed quit without replay. The native quit fixture runs both catalog and session-bound controls with visible and windowless apps, verifies cancellation, and rejects stale generations before any termination request.

# Boundaries

Screen recording and accessibility permissions remain explicit macOS grants. A save-dialog cancellation must never be bypassed or escalated to forced exit.

See the [distribution record](host-application-validation.md) for actual tested targets.

# Evidence

- `scripts/check_host_application_lifecycle.mjs`: Chromium, Firefox and WebKit popup closure with production viewer assets and a controlled host stream; records first-frame acknowledgment, state response, close call stack and actual page close. This does not certify native window capture.

- `scripts/check_macos_host_application_waiting.py` and `scripts/fixtures/nativeHostApplication.swift`: disposable lifecycle scenarios.

- `scripts/check_macos_host_application_termination.py`: host-driven exit before/after a window, last-window closure with a live process, and explicit detachment.
