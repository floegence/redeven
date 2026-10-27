---
type: Interaction Contract
title: Cross-platform host application behavior
description: Compare aligned user operations and operating-system limits for macOS and Linux host applications.
tags: [applications, macos, linux, lifecycle]
timestamp: 2026-10-07T05:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Host Applications separates viewing, sharing, window closure and process exit on
both platforms. Ordinary actions preserve unsaved work and respect app cancellation.
Only an independently confirmed Force quit may bypass saving. The backend owns
process evidence, and the interface names the actual supported operation. OS
session, display and service policies remain authoritative; unavailable recovery
must not silently relaunch an unrelated or replacement process.

# Contract

| Operation | macOS | Linux |
| --- | --- | --- |
| Close outer Desktop window / browser popup | Release this client lease; app survives | Same |
| Network loss, reload, second viewer | Reconnect same live app; stale input is revoked | Same |
| Release this client lease | End this capture/route; other clients and app survive | End this proxy/route; other clients and app survive |
| No window for more than 40 seconds | Waiting, with native menu/reopen | Waiting, reconnect same process without relaunch |
| Close last window | Viewer closes; app decides whether its process exits | Same |
| Cancel normal close/quit | Preserve application and save dialog | Same; ordinary control is Close all windows |
| Explicit Force quit in library | Confirm loss warning; exact AppKit instance | Confirm loss warning; exact owned backend and descendants |
| Orderly Runtime shutdown or process exit | Native app remains discoverable | Private display survives; new Runtime verifies/reconnects it |
| Running list | Regular apps in the logged-in OS session | Caller-owned Redeven instances, including detached/windowless apps |
| Host reboot / display server destruction / OS cleanup | No survival guarantee | Same; Runtime cgroup cleanup may also end its virtual display |

## Accepted operations and visible state
Quit and force-quit requests are asynchronous. The Host Applications surface must close the confirmation dialog after acceptance and show a per-application pending state until the authoritative running snapshot confirms the target instance is gone.

The first Force quit action only enters that state; only its final confirmation sends the destructive host request.

# Boundaries

Linux cannot generically request AppKit-style application quit or reopen, nor adopt an arbitrary process on another display. macOS requires its real logged-in graphical session and explicit capture/input permissions. Neither backend can preserve an application after its OS or display environment has been destroyed.

# Evidence

- [Linux instance lifecycle](linux-application-lifecycle.md): surviving private backends, connection revocation and exact-instance controls.

- [Lifecycle acceptance](../operations/host-application-lifecycle.md): focused native and renderer scenarios.
