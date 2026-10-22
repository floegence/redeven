---
type: Runtime Contract
title: Native macOS host applications
description: Real application discovery, direct local launch, owned remote window capture and human input on macOS.
tags: [runtime, desktop, applications, macos, security]
timestamp: 2026-09-23T08:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven's macOS adapter owns native host application discovery and human-operated
window sessions. Application identity comes from installed bundles. A trusted
Desktop local-environment route launches the real app directly; remote access
captures the selected application's actual window, including an already running
single-instance app. Apps run as the Runtime user,
without containers, virtual machines, X11 or an independent desktop. The existing
[host application authorization](host-applications.md) applies to every operation
and stream. Missing permissions or graphical login block streaming explicitly.
Network loss preserves the app; reconnection attaches to the same process. Explicit
quit is independent of sharing and binds to the selected OS process generations.

# Contract

## Catalog and local launch
AppKit discovers applications in standard system/user application directories, running application bundle paths, and explicit custom absolute `.app` paths. Canonical bundle paths define identity; localized bundle metadata and system icons define presentation.

The [application management contract](macos-application-management.md) owns live OS inventory, explicit quit confirmation, process-generation validation and the distinction between quitting an app and stopping its sharing session.

## Remote window ownership and transport
The [native capture owner](macos-application-capture-owner.md) uses one Swift process and host-application protocol 2, separate from Computer Use. The helper verifies the returned canonical bundle path and binds its process, so single-instance applications reuse their existing windows.

Local focus during same-window recapture grants no remote input authority; composition begun before decoded pixels cannot acquire permission by waiting for a frame.

## Human control and lifecycle
Remote input shares the host's real graphical session and foreground. Explicit input activates and raises the bound window; foreground identity, focused AX window and pointer hit ownership must be verified before injection.

Protected content, inaccessible custom controls, separate-process dialogs, and apps with unusual window ownership require application-specific validation. macOS 13 API compatibility is a build contract, not a claim of testing every OS version, Intel host or third-party application.

# Boundaries

Every operation and stream keeps Host Applications authorization. Network loss preserves the application; reconnect binds the same process, and quitting remains independent of viewer closure.

# Evidence

- `desktop/native/computer-host/Sources/RedevenComputerHost/HostApplications.swift`: bundle discovery, owned capture and input, menu and graceful window lifecycle.

- `desktop/native/computer-host/Sources/RedevenComputerHost/HostApplicationWindows.swift` and `desktop/native/computer-host/Tests/RedevenComputerHostTests/HostApplicationTests.swift`: authoritative inventory and transient window lifecycle.

- `internal/hostapps/macos.go` and `macos_test.go`: helper resolution, stream credentials, connection ownership, native launch and cleanup.
