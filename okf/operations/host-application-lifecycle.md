---
type: Validation Guide
title: Host application lifecycle acceptance
description: Scenario-based evidence for native application sharing and explicit recovery boundaries.
tags: [applications, macos, linux, validation]
timestamp: 2026-09-21T07:00:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-25"
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

| Scenario | Required result and evidence |
| --- | --- |
| Existing single-instance Mac app | Reuse exact process; lease release preserves it (native fixture) |
| First window after 40 seconds | Keep waiting, then reveal without relaunch (48-second fixture and Go watchdog) |
| Multiple windows | Counted picker with literal titles, retained selection/focus and direct switching (viewer/browser tests) |
| Close cancelled | Retain process/session and viewer (native cancellation fixture) |
| Unreadable/replaced surface | Uncertainty never expires into closure (Swift inventory/presence tests) |
| Linux dialog-only app | Reveal decoded dialog at native dimensions (Xpra adapter) |
| Final window actually closes | Close established physical viewer (native/viewer tests) |
| Last lease released | End sharing, retain newly launched app and all windows (multi-window fixture) |
| One stale quit selection | Reject whole selection before termination (native quit fixture) |
| App cancels quit | Keep process, pixels and sharing; permit another explicit request (cancellation/reconnect fixture) |
| Unknown quit result | Keep confirmation error; never infer exit or auto-retry (Env App test) |
| Read-only caller | May list running apps, never quit/detach (API/UI tests) |
| Network loss/reload | Keep app; suspend capture/input, reclaim buffers, reconnect same session/current credential (WebSocket/native/viewer tests) |
| Second viewer | Revoke previous input, release held keys, suspend old capture before successor resumes (WebSocket/native tests) |
| Permission loss/console lock | Invalidate capture/input and expose distinct recovery (Swift/viewer tests) |
| Helper exit | Sharing failure is not app exit; reclaim route, credential, buffers and helper before terminal state (Go/viewer tests) |
| Late callback/unknown terminal reason | Ignore stale results; retain terminal page without automatic physical closure (macOS/Xpra viewer tests) |
| Unproven foreground/window ownership | Nonblocking input failure, no replay into another app (native/viewer tests) |
| Missing video decoder | Negotiate same-process image transport (picture/viewer acceptance) |

Toolbar checks cover content resize below its fixed bar, bounded popovers at
320/390/1000 px, native-menu keyboard access, distinct window close/confirmed quit,
late menu dismissal and no replay of unconfirmed quit. Native quit tests cover
catalog/session controls, visible/windowless apps, cancellation and stale generations.

# Boundaries

Screen-recording and accessibility are explicit macOS grants. Save-dialog cancellation
never permits forced exit. [Distribution evidence](host-application-validation.md)
names tested targets; [platform behavior](../architecture/host-application-behavior.md)
owns OS differences.

# Evidence

- `scripts/check_host_application_lifecycle.mjs`: production assets with controlled
  host streams in Chromium/Firefox/WebKit; records first-frame acknowledgment, state,
  close stack and page closure, without claiming native capture certification.
- `scripts/check_macos_host_application_waiting.py` and
  `scripts/fixtures/nativeHostApplication.swift`: disposable lifecycle scenarios.
- `scripts/check_macos_host_application_termination.py`: exit before/after windows,
  last-window closure with a live process and explicit detach.
