---
type: Runtime Contract
title: macOS application management and graceful quit
tags: [runtime, applications, macos, lifecycle, security]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven manages authorized app actions; OS owns liveness, apps saving/quit cancellation. Quit binds original process generation without force/retarget/assumed exit. Stale/unavailable targets retain sharing/errors; native sessions own capture/input/viewer closure independently.

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
