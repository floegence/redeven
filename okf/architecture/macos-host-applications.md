---
type: Runtime Contract
title: macOS application authority, capture and lifecycle
tags: [runtime, desktop, applications, macos, security]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Redeven opens installed macOS bundles as the Runtime user and binds remote capture to actual windows/process generations. One helper owns independent sharing channels; decoded current pixels precede input. OS/app facts govern quit and closure, preserving unsaved work through viewing failures.

# Contract

## Discovery and input
AppKit discovers standard directories, running bundle paths and explicit absolute .app paths. Canonical path defines identity; localized metadata/system icons provide presentation. Launch locally through trusted Desktop Local or capture remote selected windows with host-application protocol2, separate from Computer Use. Verify returned bundle path/process and reuse single-instance windows.

Remote input shares the real foreground session: activate/raise the bound window, verify foreground/focused AX window/pointer hit ownership before injection. Local focus during recapture grants no remote authority; pre-frame composition never becomes authorized by waiting.

## Helper
One lazy Manager-owned Swift process serves Runtime catalog/app/desktop channels, not one persistent helper per app. Empty inventory leaves it idle until Runtime closes, retaining ScreenCaptureKit identity. Released FloeNativeDesktop owns capture/native desktop input; separate binary media pipe and bounded per-channel queues avoid control serialization. Each response queue holds128 messages for supported result bursts. Authorization, input and frame credit stay independent; suspending one capture cannot affect another. Helper failure ends sharing, never apps; later explicit open may recover under native validation. Shutdown preserves unsaved applications.

## Management
AppKit's Running applications includes regular processes launched outside Redeven and windowless apps. Requests bind selected bundle plus opaque canonical path/PID/launch-time generations. Explicit graceful quit cannot force-kill/retarget. Acceptance is not exit evidence; stale/unavailable targets keep sharing and actionable error. Failed viewer admission never rolls back host sessions from stale catalog state.

## Windows
Native registry distinguishes present, unknown and confirmed-empty AX inventories. Live processes wait indefinitely for first shareable window; no first-window deadline. Client release during waiting ends the lease normally, not launch failure. Confirmed destruction alone starts last-window grace. Capture availability never defines lifetime: AX identity can survive surface replacement while input generation renews and retired callbacks are fenced. Launch/helper failures stay failures; missing pixels cannot turn confirmed process exit into launch failure.

Terminal reasons remain exact: application_exited=bound process exit, windows_closed=last shared window closure, sharing_stopped=detachment. Neither closing windows nor sharing claims quit. Runtime shutdown releases capture/route/input, preserving applications; new Runtime discovers them through OS, but sharing needs explicit open. [Lifecycle acceptance](../operations/host-application-validation.md#input-cursor-and-lifecycle-acceptance) separates recovery evidence from compatibility limits.

## Menus
Only explicit inspection reads the bound app's AX menu; never on launch/first frame. Structurally remove leading Apple/system/cross-app branches before issuing handles, independent of title/language. Literal app name is first exposed group, no replacement system menu/warning. Empty/filtered/truncated containers never become executable leaves. Handles bind app and capture/wait generation; only enabled current leaves with verified ancestry execute. Removed/relocated/excluded/disabled/nonleaf/stale handles fail without pressing or disturbing app/capture. AX cannot describe every command's effect; local launch leaves OS menu unchanged.

## Picture
Native helper validates bounds and captures at min(viewer DPR,native window density,longest-edge limit). Settings never resize app. Preferences/stats preserve process/permission/input identity. Browser H.264 WebCodecs software capability may receive VideoToolbox hardware output; encoder unavailability uses declared JPEG, decoder failure explicitly renegotiates image transport. Unchanged resize retains credit; ack only decoded current-generation frames. Runtime logs connection-to-first-frame/generation; browser logs first-decoded duration. Limits such as60 FPS are ceilings, not achieved guarantees; latency/capture/encoding/decode/network constrain delivery. Capture failure keeps session recovery policy.

# Boundaries

Requires actual graphical login, macOS13+ helper and explicit capture/input permissions; no private headless AppKit, VM/container/X11/XQuartz substitute. Protected/custom controls, separate-process dialogs and unusual window ownership need qualification. Build compatibility does not certify every OS/Intel/app. Viewer closure and quit remain separate authorities.

# Evidence

- `desktop/native/computer-host/Sources/RedevenComputerHost/HostApplications.swift`, `HostApplicationWindows.swift`, `Accessibility.swift`, `HostApplicationMenu.swift`, `HostApplicationCapture.swift` and `HostApplicationHost.swift`: native identity/authority/lifetime owners; adjacent HostApplication tests cover admission, windows, channels and profiles.
- `internal/hostapps/macos.go`, `macos_test.go`, `macos_host.go`, `macos_host_test.go`: helper routing/reaping/backpressure, permissions, streams, launch/detach/cleanup and generation fencing.
- `internal/codeapp/appserver/host_applications.go`, `host_applications_test.go`, `host_application_viewer/macos.js` and `internal/envapp/ui_src/src/ui/services/macHostApplicationViewer.test.ts`: authenticated actions, decode/controls/stale callbacks.
- `scripts/check_macos_host_application_concurrency.py`: real suspend/open, alternating reconnect, independent credit/detach. `scripts/check_macos_host_application_waiting.py --scenario menu_scope` and nativeHostApplication.swift: real Apple filtering, windowless creation, handle/container mutations and harmless sentinels.
