---
type: Interaction Contract
title: Host application lifecycle and Linux instance recovery
tags: [applications, macos, linux, lifecycle]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Viewing, sharing, closing windows and ending processes remain distinct across platforms. The first Force quit action only enters that state; only its final confirmation sends the destructive host request. Instance records bind opaque ID, authorized owner, metadata, boot/PID/start, component identity and private backend endpoint. Reusable window IDs never grant authority.

# Contract

## Cross-platform behavior
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

### Accepted operations and visible state
Quit and force-quit are asynchronous. Shell retains per-application admission and pending state across view replacement and polls authoritative running instances. Only disappearance of the exact target instances settles the operation. The confirmation closes after acceptance; stale cached inventory cannot settle it. No observer retries a quit or escalates it. Environment retirement fences late responses.

## Linux recovery
- Upstream supervises GIO/descendant/sandbox lifetime. Preparation, launcher failure, app exit, windows and first pixels are separate facts. Xpra retains published readiness/final-window/audio-disable behavior.
- Browser profiles are stable private directories per owner/catalog app. Observed process-tree exit before first window fails launch even with zero status; live processes may keep waiting.
- Linux ordinary control is Close all windows, respecting save/cancel. Explicit force quit never follows close, disconnect, cancellation or uncertain response automatically. Acceptance is not exit proof; remove running rows only after kernel confirmation.

# Boundaries

Linux cannot generically request AppKit-style application quit or reopen, nor adopt an arbitrary process on another display. macOS requires its real logged-in graphical session and explicit capture/input permissions. Neither backend can preserve an application after its OS or display environment has been destroyed.

Reconnect cannot restore destroyed display/OS processes or change ownership policy. Surviving-instance recovery never substitutes a replacement launch.

# Evidence

- [Linux instance lifecycle](#linux-recovery): surviving private backends, connection revocation and exact-instance controls.
- [Lifecycle acceptance](../operations/host-application-validation.md#input-cursor-and-lifecycle-acceptance): focused native and renderer scenarios.
