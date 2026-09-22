---
type: Validation Guide
title: Host application lifecycle acceptance
description: Scenario-based evidence for native application sharing and explicit recovery boundaries.
tags: [applications, macos, linux, validation]
timestamp: 2026-09-21T07:00:00Z
---
# Summary

This matrix records observable lifecycle acceptance for Host Applications. The
[shared authorization contract](../architecture/host-applications.md) and
[macOS session owner](../architecture/macos-host-applications.md) remain normative.
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
| Existing single-instance Mac app | Reuse its exact process; stop sharing preserves it | Real native fixture |
| First window delayed beyond 40 seconds | Keep waiting; display eventual pixels without relaunch | Real 48-second fixture, Go watchdog test |
| Background app with no window | Keep native menu and reconnect available | Real menu/reopen fixtures, viewer tests |
| Newly launched app stopped before first window | Normal sharing termination, no launch error | Real stop fixture, Go lifecycle test |
| App exits before any window | Confirmed application exit, independent of who requested it | Real terminal fixture and Go lifecycle test |
| Multiple shareable windows | Visible counted picker, literal titles, current selection and direct switching; keep picker/focus during updates | Viewer and responsive browser tests |
| Native capture indicators and utility panels | Exclude passive capture chrome; retain operable utility panels; counts follow actual windows | Swift classification and real multiple-window fixture |
| New focused secondary window | Show it automatically; return to main when it closes | Real multiple-window fixture |
| User chooses an existing window or switches rapidly | Preserve explicit choice across inventory refresh; the latest selection wins | Real multiple-window fixture |
| Close cancelled by app | Retain process and session; do not close viewer optimistically | Real close-cancellation fixture |
| Window replaced during animation | Allow replacement interval; discard prior generation | Real replacement fixture, Swift presence tests |
| Window list temporarily unreadable | Cannot conclude application closure | Swift inventory tests |
| Window minimized or app hidden | Keep session; explicit reconnect restores owned window | Real fixture with a sustained hidden/minimized interval |
| Linux application opens only a dialog | Reveal decoded dialog; retain its native dimensions | Xpra adapter test |
| Final window actually closes | Close established physical viewer | Native fixture and viewer tests |

# Explicit application quit

| Scenario | Expected outcome | Evidence |
| --- | --- | --- |
| Direct native launch or no remaining window | Remain in the live OS list independently of sharing sessions | Real quit fixture, Env App interaction test |
| Sharing stopped for a newly launched app | End only sharing; keep all native windows and process alive | Real multiple-window quit fixture |
| Quit confirmation while process restarts | Preserve the original selected generation; never silently retarget | Swift identity, native stale-selection and Env App tests |
| One selected instance is stale | Reject the entire selection before any termination request | Real quit fixture |
| App cancels quit | Preserve process, pixels and active sharing; allow another explicit request | Real cancellation and reconnect fixture |
| Quit accepted | Keep row until OS confirms process exit; close established viewer when sharing ends | Real quit fixture and existing viewer closure tests |
| Quit before first window | Confirmed exit ends sharing normally, without a launch failure | Go exact-instance lifecycle test |
| Request outcome unknown | Keep an error in the confirmation; never infer exit or retry automatically | Env App interaction test |
| Read-only caller | Running list is readable; quit and detach are forbidden | API permission and Env App tests |
| Routine OS list refresh | Keep keyboard focus on unchanged application controls | Env App interaction test |

# Transport, access and input

| Scenario | Expected outcome | Evidence |
| --- | --- | --- |
| Network loss or viewer reload | Preserve app; suspend native capture/input, reclaim frame buffers, then reconnect the same session with current credential | Go WebSocket, native startup fixture and viewer tests |
| Second viewer attaches | Revoke previous input connection, release held input, suspend the old capture and let the new viewer resume it | Go WebSocket replacement and native startup fixture |
| Capture source fails | Retain application menu and alternate-window selection; offer reconnect | macOS viewer test |
| Permission revoked or console locked/unavailable | Invalidate capture/input; give distinct permission or unlock guidance | Swift access classification and viewer event tests |
| Permission restored | Explicit reconnect rebuilds capture and input receipt listener | Native reconnect path; actual OS permission toggling is not part of automated acceptance |
| Helper unexpectedly exits | Sharing failure, not proof of application exit; reclaim route, credential, frame buffers and helper process before terminal state | Go helper and viewer tests |
| Terminal sharing status | Keep owner-protected state route and native end reason; clear stream credential | Go route/ownership tests |
| Reload after app quit / final window close / detach | Immediate distinct terminal page, no stream, no spinner, no relaunch; dismiss when the window permits it | Real native terminal fixture, both viewer suites and browser layout tests |
| Disconnect races host exit | Check host state before presenting an outcome | Viewer reconciliation tests |
| State check stalls or completes late | Bounded recovery; ignore stale outcome | Viewer timeout and generation tests |
| Session access denied (401/403/423) | Sign-in/access guidance, retry after recovery; never claim exit | Viewer HTTP tests |
| Malformed successful state response | Do not open a stream or infer application termination | Viewer contract test |
| Old route returns HTTP 404/410 | Explain session is unavailable; return to library; never infer app exit | Both viewer test suites |
| Old status/decode callback arrives late | Cannot end, repaint or block a newer connection | macOS/Xpra viewer tests |
| Window changes while text composition or pointer move is pending | Discard pending input rather than send it to a new target | macOS viewer tests |
| Native menu belongs to retired generation | Discard it; deliver new window before its dependent menu | macOS viewer and Go ordering tests |
| Input cannot prove foreground/window ownership | Nonblocking failure; no replay into another app | Native input fixture and viewer operation tests |
| Video decoder unavailable or fails | Negotiate image transport for the same process | Existing picture/viewer acceptance |

# Toolbar acceptance

The viewer toolbar acceptance also covers content-area resizing below the fixed
bar, bounded popovers at 320/390/1000 pixels, native-menu keyboard navigation,
separate window close and confirmed application quit, late menu dismissal, and
unconfirmed quit without replay. The native quit fixture runs both catalog and
session-bound controls with visible and windowless apps, verifies cancellation,
and rejects stale generations before any termination request.

# Boundaries

Screen recording and accessibility permissions remain explicit macOS grants.
Automated acceptance does not lock the user's Mac or revoke its permissions.
Those transitions use native access classification and injected protocol events;
real window, input, capture and process tests run only against disposable bundles.
A save-dialog cancellation must never be bypassed or escalated to forced exit.

Protected content, secure system dialogs, nonstandard accessibility/window
ownership, windows owned by other processes and background-only tools can remain
unavailable. A screen or input permission cannot override those OS boundaries.
macOS requires a logged-in graphical session and is not an independent headless
desktop. Linux requires a compatible X11 application and the qualified native
component stack; Wayland-only apps, singleton redirection and GPU/host policy
constraints require separate validation. See the
[distribution record](host-application-validation.md) for actual tested targets.

# Evidence

- `scripts/check_macos_host_application_waiting.py` and `scripts/fixtures/nativeHostApplication.swift`: disposable lifecycle scenarios.
- `scripts/check_macos_host_application_termination.py`: host-driven exit before/after a window, last-window closure with a live process, and explicit detachment.
- `scripts/check_macos_host_application_quit.py`: exact-process quit/force quit, cancellation, fresh-helper inventory and detachment.
- `internal/hostapps/linux_lifecycle_test.go`: installed Linux windowless lifetime, real Runtime process exit, exact-instance force quit, save cancellation and rotated credentials.
- `scripts/check_macos_host_applications.py`: real capture, input, quality and process ownership acceptance.
- `desktop/native/computer-host/Tests/RedevenComputerHostTests/HostApplicationTests.swift`: unreadable inventory and access classification.
- `internal/hostapps/macos_test.go`: startup, authenticated connection ownership, termination and delivery ordering.
- `internal/envapp/ui_src/src/ui/services/macHostApplicationViewer.test.ts` and `hostApplicationViewer.test.ts`: renderer state, recovery, stale callbacks and input binding.
- `internal/codeapp/appserver/host_applications_test.go`: owner/full-permission terminal routes.
