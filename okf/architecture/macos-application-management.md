---
type: Runtime Contract
title: macOS application management and graceful quit
description: Live OS application inventory, generation-bound quit and independent sharing detachment.
tags: [runtime, applications, macos, lifecycle, security]
timestamp: 2026-09-21T07:00:00Z
---
# Summary

Redeven owns the Host Applications management UI and authenticated native actions.
The OS owns process liveness, and the application owns saving or cancelling quit.
Running applications remain manageable without a sharing session. An explicit
quit validates the original process generations; it never force-kills an app,
retargets a replacement process, or treats command acceptance as proof of exit.
An unavailable or stale target returns an actionable error and preserves sharing.
The [native session contract](macos-host-applications.md) owns capture, input and
physical viewer closure.

# Running applications and explicit quit

**Running on this Mac** uses AppKit's current regular application processes,
including direct native launches, windowless applications and apps opened outside
Redeven. Sharing sessions are not a process inventory. Applications remain
manageable after a viewer or Runtime restarts; names and icons still come from
host bundles. A lightweight snapshot refreshes while the library is visible and
on focus, without rebuilding icons. Stable rows preserve keyboard focus. Background
services and menu-bar-only accessory processes are outside this regular-app list.

Quit requires read, write and execute permission, an unlocked graphical session,
and an explicit confirmation naming the application and explaining that its host
windows, including those opened outside Redeven, are affected. The request contains
the selected bundle identity and opaque instance identifiers derived from canonical
bundle path, PID and launch time. Multiple live instances of the same bundle are
grouped in one row. The native helper validates the entire selected set against a
fresh OS inventory before requesting termination. A stale selection fails without
retargeting another generation; renderer-supplied PIDs and executable paths are
never quit targets.

The remote viewer also provides **Quit application** in its fixed top toolbar,
separate from **Close application window**. An anchored confirmation names the
application, explains the effect on host windows, and initially focuses Cancel.
The authenticated stream accepts only `quit_application`, not the catalog's
arbitrary selection action. The bundled helper derives the target from the bound
`NSRunningApplication` and requires the current capture/wait generation, then uses
the same fresh instance validation as catalog quit. Renderer-supplied bundle IDs,
instance IDs or PIDs cannot change that target. A windowless session retains this
action. An acknowledgement reports only request acceptance; an unconfirmed request
gets explicit feedback after six seconds and is never retried automatically.
A confirmed end after explicit viewer quit closes that viewer even if no first
frame arrived; simply reloading an already ended session still shows its result.

`NSRunningApplication.terminate()` requests ordinary application termination.
Acceptance does not prove exit: save confirmation or cancellation keeps the app
and its viewer alive. The library offers opening the app to finish the native
dialog, keeps quit available, and removes the row only after an OS snapshot confirms
exit. An unconfirmed transport result remains an actionable error without automatic
retry. Explicit quit intent for an attached windowless process prevents a confirmed
exit from being mislabeled as startup failure; it never ends a session optimistically.
There is no force-quit fallback. Existing launch rollback retains its narrower
ownership rule and may request termination only for its newly launched process.

# Evidence

- `desktop/native/computer-host/Sources/RedevenComputerHost/HostApplications.swift`: OS discovery, process-generation identity and graceful termination.
- `internal/hostapps/macos.go` and `macos_test.go`: management routes, independent detach and confirmed windowless exit.
- `internal/codeapp/appserver/host_applications.go` and `host_applications_test.go`: authenticated permission boundary and audit events.
- `internal/envapp/ui_src/src/ui/pages/EnvHostApplicationsPage.tsx` and `EnvHostApplicationsPage.test.tsx`: running list, confirmation, cancellation guidance and focus retention.
- `scripts/check_macos_host_application_quit.py`: disposable native, windowless, cancellation and stale-generation acceptance.
