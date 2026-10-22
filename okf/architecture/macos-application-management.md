---
type: Runtime Contract
title: macOS application management and graceful quit
description: Live OS application inventory, generation-bound quit and independent sharing detachment.
tags: [runtime, applications, macos, lifecycle, security]
timestamp: 2026-09-21T07:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
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

# Contract

## Running applications and explicit quit
**Running applications** uses AppKit's current regular application processes, including direct native launches, windowless applications and apps opened outside Redeven.

The request contains the selected bundle identity and opaque instance identifiers derived from canonical bundle path, PID and launch time.

A failed viewer opening also never rolls back a host session based on stale catalog state.

# Boundaries

Quit remains an explicit native request, bound to the original process generations. It cannot force-kill or retarget another process. Acceptance is not evidence of exit, and stale or unavailable targets retain sharing while reporting an actionable failure.

# Evidence

- `desktop/native/computer-host/Sources/RedevenComputerHost/HostApplications.swift`: OS discovery, process-generation identity and graceful termination.

- `internal/hostapps/macos.go` and `macos_test.go`: management routes, independent detach and confirmed windowless exit.

- `internal/codeapp/appserver/host_applications.go` and `host_applications_test.go`: authenticated permission boundary and audit events.
