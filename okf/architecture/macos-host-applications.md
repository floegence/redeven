---
type: Runtime Contract
title: macOS application authority, capture and lifecycle
tags: [runtime, desktop, applications, macos, security]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Redeven opens installed macOS bundles as the Runtime user and binds remote capture to actual windows/process generations. Remote input shares the real foreground session: activate/raise the bound window, verify foreground/focused AX window/pointer hit ownership before injection.

# Contract

## Discovery and input
AppKit discovers standard directories, running bundle paths and explicit absolute .app paths. Canonical path defines identity; localized metadata/system icons provide presentation. Launch locally through trusted Desktop Local or capture remote selected windows with host-application protocol2, separate from Computer Use. Verify returned bundle path/process and reuse single-instance windows.

Local focus during recapture grants no remote authority; pre-frame composition never becomes authorized by waiting.

## Helper
One lazy Manager-owned signed `Redeven Desktop Access.app` serves Runtime catalog/app/desktop channels. Development uses the separate `Redeven Desktop Access Dev.app` identity. The bare executable is only a stdio relay; published FloeNativeDesktop launches the exact application through Launch Services before initializing privacy APIs. Private authenticated sockets preserve control and media channels. Empty inventory leaves it idle until Runtime closes, retaining ScreenCaptureKit identity. Released FloeNativeDesktop owns capture/native desktop input; separate binary media pipe and bounded per-channel queues avoid control serialization. Each response queue holds128 messages for supported result bursts. Authorization, input and frame credit stay independent; suspending one capture cannot affect another. Helper failure ends sharing, never apps; later explicit open may recover under native validation. Shutdown preserves unsaved applications.

## Management
Remote application setup explains screen recording as showing application windows and accessibility as mouse/keyboard control. Existing grants are reused; local native launch needs neither. Permission requests, fixed Settings panes and revealing the actual helper in Finder are distinct explicit actions. A pending native prompt never immediately opens Settings. `permission_app_name` comes from the running helper bundle, never a parent environment. Setup presents one current permission, a persistent two-step completion trail (screen, then input), the exact app name and one primary action. After a request, that action becomes fixed Settings navigation; no duplicate action block is appended. View-only desktop omits input. Opening the visible setup step, returning from its explicit system permission flow, or pressing Check again uses `check_permissions`: renew only an idle native owner and re-read both grants. The lifecycle admission lock spans idle inspection and shutdown; any existing channel preserves its owner. A concurrent probe defers renewal until the next idle admission without losing the request. Active sharing can be restarted only through the existing confirmed recovery action. Polling and hidden setup remain passive. Invalidate the catalog after permission operations so a preceding in-flight snapshot cannot certify the result; refresh both application and desktop status. Identity itself grants no capability. Missing Settings entries offer Finder reveal plus explicit add guidance. Applying changed permissions confirms that sharing connections will end, restarts only the helper, then probes the new process. Runtime, feature intent and open user applications survive; old channels cannot regain input authority and no operation is replayed. Opening settings neither grants nor revokes access. Feature pause/removal follows [independent access intent](host-applications.md#feature-access), never OS grant revocation.

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

- November 8, 2026: published v0.27.1 consumer qualification verified signed
  helper identity, Launch Services parentage, catalog/desktop permission parity,
  native app launch without capture/input grants, fresh helper PIDs, EOF/SIGTERM/
  SIGKILL cleanup and survival of the opened fixture application. No TCC grant was
  changed. This evidence did not certify a newly granted capture/input path.
- Focused Swift, Go race, API authorization, localized browser recovery and signed
  nested-bundle checks cover explicit requests, Finder reveal, confirmed restart,
  preserved feature intent, old-channel fencing, and desktop focus restoration.

- November 9, 2026: the live old helper returned screen=false while a fresh
  instance of the exact signed bundle returned screen=true and input=false.
  The opt-in `TestMacPermissionNativeRenewalAndCapture` exercised the actual
  published helper through the changed manager: idle renewal, retained grant,
  1600x900 H.264 media and uninterrupted active capture during another check.
  No TCC grant was changed and no frame was saved. Input grant transitions remain
  deterministic fixture coverage; this machine had no helper accessibility grant.
