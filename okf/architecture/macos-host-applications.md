---
type: Runtime Contract
title: Native macOS host applications
tags: [runtime, desktop, applications, macos, security]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Redeven opens installed bundles as Runtime user. Trusted Desktop Local launches directly; remote capture binds actual selected windows/processes. Authorization gates operations/streams. Missing login/permissions blocks capture; disconnect preserves apps and exact-process recovery.

# Contract

- AppKit discovers standard directories, running bundle paths and explicit absolute `.app` paths. Canonical path defines identity; localized metadata/system icons define presentation. [Management](macos-application-management.md) owns inventory and generation-bound quit.
- [Capture owner](macos-application-capture-owner.md) uses one Swift process with host-application protocol 2, separate from Computer Use. Verify returned bundle path/process and reuse existing single-instance windows.
- Remote input shares the real foreground session. Activate/raise the bound window, then verify foreground, focused AX window and pointer hit ownership before injection. Local focus during recapture grants no remote authority; pre-frame composition cannot become authorized by waiting.

# Boundaries

No container, VM, X11 or independent desktop is involved. Protected content, custom controls, separate-process dialogs and unusual window ownership need app-specific qualification. macOS 13 compatibility is a build contract, not proof for every OS/Intel/app combination. Quit remains separate from viewer closure.

# Evidence

- `desktop/native/computer-host/Sources/RedevenComputerHost/HostApplications.swift`: bundle discovery, owned capture and input, menu and graceful window lifecycle.

- `desktop/native/computer-host/Sources/RedevenComputerHost/HostApplicationWindows.swift` and `desktop/native/computer-host/Tests/RedevenComputerHostTests/HostApplicationTests.swift`: authoritative inventory and transient window lifecycle.

- `internal/hostapps/macos.go` and `macos_test.go`: helper resolution, stream credentials, connection ownership, native launch and cleanup.
