---
type: Desktop Integration Contract
title: Semantic desktop operations and explicit control
description: Use macOS window Accessibility and private Linux AT-SPI before image input while preserving user control.
tags: [ai, computer-use, accessibility, desktop]
timestamp: 2026-09-17T00:00:00Z
---
# Summary

`ComputerUseRuntime` owns desktop target execution. macOS targets an explicit
application window; Linux owns a private Xvfb and D-Bus session. Semantic actions
use native accessibility first. A foreground operation requires current task
authorization and respects explicit Stop and takeover. Platform permissions do not prove
that every application or action can run unobtrusively in the background.

# Contract

## macOS windows

The Swift helper inventories regular and accessory application windows, reads AX roles, labels,
non-sensitive values, supported actions and bounds, and exposes bounded subtree
queries. A node reference is scoped to the selected window instance. AXObserver
wakes condition waits. Removed or changed controls require new observation.
The inventory adapter is not an executable target. Only discovered window
identities enter the target registry. A rejected target cannot replace the
thread's selected window; model feedback directs subsequent calls to `current`
or an omitted target without substituting a different resource automatically.
The JSONL reader consumes available pipe bytes without waiting for a full buffer
or EOF. Short and split requests stay responsive while stdin remains open,
including cancellation during an operation.

Press and editable-value operations use AX. Because an arbitrary application
may activate itself in response to AX, mutating semantic operations currently
check foreground authorization and announce that possibility before dispatch,
without explicitly activating the app. This is conservative capability handling;
no static per-app certification of background behavior is implied.

Canvas input, dragging and shortcuts use the existing native input implementation
through the same execution and result path. The helper announces the target and
reason before foreground input. It records the previous focus and pointer and
restores them only when the original window remains valid and the user has not
intervened. Incidental keyboard or pointer input does not pause the task; it
only suppresses optional focus restoration. Before each HID injection, the
helper verifies the exact authorized application and window remain focused.
Losing that target focus stops injection rather than sending events elsewhere.
The event tap acknowledges helper-marked input without inspecting key contents;
missing delivery confirmation is an unknown effect. Cancellation balances
helper-owned input without releasing keys physically held by the user.
Wheel events bind their coordinates to the selected control as well as moving
the pointer. Event creation precedes injection, so the wheel must not inherit
the user's original pointer position from construction time.
`computer.scroll` accepts paired window-relative `x` and `y` coordinates for
canvas regions; semantic scrolling uses the referenced control. Without a
point, the native default is the window center. A previous click must not use
the restored physical pointer as a hidden scroll target.

Capture is limited to the target window and retains existing excluded-window and
sensitive-content rules. Filtered capture failure never falls back to the whole
screen. Screen Recording and Accessibility readiness remain distinct from task
app and foreground grants. Secret fields enter the existing private takeover
channel rather than model observations.

## Linux private desktop

The Xvfb owner starts a private session D-Bus and AT-SPI bus. Desktop applications
receive the exact owned display, Xauthority and bus addresses. The executor
rejects socket or environment paths leading outside that private desktop; it
never discovers or attaches to another logged-in user's session.

AT-SPI reads bounded semantic trees and dispatches supported actions and editable
text through the selected process. Defunct or destroyed objects fail as stale.
AT-SPI events wake waits. Password semantics block normal observation. X11 input
and image capture remain available for controls without accessibility, within
the same isolated target. Focus/pointer preparation counts as dispatched effects;
lost acknowledgements do not trigger replay.

Shutdown and cancellation retire the exact owned helper/display resources.
Runtime restart does not restore script variables, node references or active
input ownership. Product target preferences and canonical historical results
follow their existing owners.

# Boundaries

Swift unit tests and real GTK/AT-SPI/Xvfb fixtures provide separate adapter
proofs. The complete Linux Flower UI scope also passes; see the
[qualification contract](computer-use-qualification.md) for its limits.
After unlocking and explicit continuation, the macOS native fixture passes AX
actions, canvas/key/wheel effects and restoration of the original application,
window and pointer after every operation. Incidental-input continuation is
qualified separately; this does not certify arbitrary applications' AX behavior.
The background occlusion fixture also passes: it orders only its own accessory
windows at the back, reads target AX labels and target-only pixels, and checks
owner exclusion plus unchanged foreground and pointer. It waits for a newly
launched window to appear in both AX and WindowServer before starting actions.
Its PNG check uses raw sRGB samples, avoiding a second calibrated-color
conversion. Lock-screen operation remains outside the supported scope.

# Evidence

- `redeven:desktop/native/computer-host/Sources/RedevenComputerHost/Accessibility.swift` - window identity, AX observation and semantic actions.
- `redeven:desktop/native/computer-host/Sources/RedevenComputerHost/ForegroundInput.swift` - foreground authorization, delivery acknowledgements and conditional restoration.
- `redeven:desktop/native/computer-host/Sources/RedevenComputerHost/ScreenCapture.swift` - bounded window capture and exclusions.
- `redeven:internal/ai/computer_atspi_linux.go` - private accessibility bus and semantic operations.
- `redeven:internal/ai/virtual_desktop_target_linux.go` - isolated Xvfb and child ownership.
- `redeven:internal/ai/computer_atspi_linux_test.go` - real GTK, destroyed controls, privacy and waits.
- `redeven:scripts/check_macos_computer_host_fixture.sh` - explicit foreground fixture qualification.
- `redeven:scripts/check_macos_computer_protocol.mjs` - short and split native JSONL requests with the input pipe open.
- `redeven:scripts/check_macos_computer_background.sh` - explicit background AX, occluded pixels and excluded-owner qualification.
