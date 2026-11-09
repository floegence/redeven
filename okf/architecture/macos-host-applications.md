---
type: Runtime Contract
title: macOS application authority, capture and lifecycle
tags: [runtime, desktop, applications, macos, security]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Runtime opens installed macOS bundles as its user and binds capture/input to actual process/window generations. Remote input shares the real foreground session: activate/raise the bound window and verify foreground, focused AX window and pointer ownership before injection.

# Contract

## Discovery and input
AppKit discovers standard locations, running bundle paths and explicit absolute .app paths. Canonical path owns identity; localized metadata/system icons present it. Trusted Desktop Local opens natively; remote selected-window capture uses host-application protocol 2, separate from Computer Use. Verify bundle/process and reuse single-instance windows. Local focus or waiting for pre-frame composition grants no remote authority.

## Helper
One lazy Manager-owned signed Redeven Desktop Access.app serves catalog/app/desktop channels; development uses its distinct Dev identity. Bare executable only relays stdio. Published FloeNativeDesktop launches the exact app through Launch Services before privacy APIs. Authenticated private sockets separate media/control; native capture/input remain upstream. Bounded per-channel queues (128 response messages) isolate credit, authorization and input. Empty inventory leaves helper idle until Runtime closes, preserving capture identity. Helper failure ends sharing, never apps; explicit later open may recover. Shutdown preserves unsaved applications.

## Management
Setup explains screen recording for window display and accessibility for control. Existing grants are reused; local launch needs neither. Request permission, open fixed Settings and reveal actual helper are separate explicit actions; a pending prompt never auto-opens Settings. permission_app_name comes from the running helper. Show one current permission, persistent screen→input steps, exact name and one action that becomes Settings after request; view-only omits input.

Visible setup/opening, return from explicit permission flow or Check again uses check_permissions to renew only idle native ownership and reread both grants. Admission lock spans idle inspection/shutdown; existing channels preserve owner. Concurrent probes defer renewal until next idle admission without losing request. Active sharing restarts only via confirmed recovery. Polling/hidden setup stays passive. Permission operations invalidate catalog snapshots and refresh app/desktop status; identity grants no capabilities. Missing Settings entries offer Finder/add guidance.

Applying permissions confirms sharing will end, restarts only helper and probes the new process. Runtime, feature intent and user apps survive; old input channels never regain authority or replay. Settings navigation does not grant/revoke. Pause/removal follows [feature intent](host-applications.md#feature-access), not OS revocation.

Running applications includes externally launched regular and windowless processes. Requests bind bundle plus opaque path/PID/launch-time generation. Graceful quit cannot force-kill/retarget; acceptance is not exit evidence. Stale/unavailable retains sharing and errors. Failed viewer admission never rolls back sessions from stale catalogs.

## Windows
Registry distinguishes present/unknown/confirmed-empty AX inventories. Live processes wait indefinitely for first window; client release ends lease normally. Only confirmed destruction starts last-window grace. Surface replacement does not destroy AX lifetime: renew input generation and fence retired callbacks. Missing pixels cannot turn confirmed process exit into launch failure.

Exact terminals: application_exited is bound process exit, windows_closed is last shared window closure, sharing_stopped is detachment. Runtime shutdown releases capture/route/input without quitting; new Runtime rediscovers apps but needs explicit sharing. [Lifecycle acceptance](../operations/host-application-validation.md#input-cursor-and-lifecycle-acceptance) separates evidence from compatibility limits.

## Menus
Only explicit inspection reads bound AX menus. Structurally remove Apple/system/cross-app branches before handles, independent of titles/language. Keep literal app name as first group; no replacement menu. Empty/filtered/truncated containers are not leaves. Handles bind app/capture-or-wait generation and verified ancestry; only enabled current leaves execute. Removed/relocated/excluded/disabled/nonleaf/stale targets fail without pressing or disrupting capture. AX cannot describe every effect; local launch leaves OS menus untouched.

## Picture
Capture uses min(viewer DPR,native density,longest-edge limit); settings never resize apps or change permission/process/input identity. Software browser H.264 may decode VideoToolbox output. Encoder failure uses declared JPEG; decoder failure explicitly renegotiates image transport. Unchanged resize retains credit; acknowledge only decoded current-generation frames. Runtime/browser log connection-to-first-frame and first-decoded duration separately. FPS settings are ceilings, not achieved rates; capture/encoding/decode/network still constrain delivery. Capture failure preserves session recovery policy.

# Boundaries

Requires actual graphical login, macOS 13+ helper and explicit capture/input grants. No headless AppKit/VM/container/X11/XQuartz substitute. Protected/custom controls, separate-process dialogs and unusual ownership require qualification; builds do not certify every OS/Intel/app. Viewer close and quit remain distinct.

# Evidence

Native HostApplication/Accessibility files and tests own identity/windows/menus/capture/lifetime. internal/hostapps/macos{,_host}{,_test}.go covers helper routing/reaping/backpressure, permissions, streams and fencing.

November 8 published 0.27.1 qualification checked signed identity, Launch Services parentage, permission parity, local launch without grants, fresh PIDs and EOF/signal cleanup while fixture app survived. It did not qualify newly granted capture/input. November 9, the old helper reported screen=false while the same signed fresh bundle reported screen=true/input=false; TestMacPermissionNativeRenewalAndCapture verified idle renewal, 1600x900 H.264 and uninterrupted active capture during another check. No TCC grants changed or frames saved. Input-grant transitions remain fixture-only because helper accessibility was not granted. Focused Swift/Go race/browser/signature checks cover review/recovery/focus and old-channel fencing.
