---
type: Runtime Contract
title: Managed host application preparation
description: Compatible installed components, independent user-directed updates, incremental transfer and same-window first-use preparation.
tags: [runtime, desktop, applications, linux, security]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The released `floe-native-apps` library owns Linux graphical component acquisition,
verification, staging, self-check and activation. Redeven owns authenticated product
routes, private state placement, localized preparation and the user's pending app
opening. Applications execute on the host. Preparation never requires a container,
VM, package-manager command, custom software source, or administrator password.
Runtime updates never depend on component updates. Compatible installed components
remain usable during an optional update and after failure or cancellation. A new
installation activates only after verification and real graphical qualification.
Closing a pending viewer prevents automatic application opening.

# Contract

## Component ownership and admission
Redeven consumes `github.com/floegence/floe-native-apps` as a published Go module
at the exact version pinned in `go.mod`. The same file's Go directive owns the
Runtime toolchain version; this contract does not maintain a separate version
pin.

Partial managed and system installations are never merged into a synthetic toolset.

The [host application contract](host-applications.md) owns restoration of the application's environment, private display isolation and host-owned dependencies.

## Preparation execution and recovery
Reading status, explicitly inspecting a transfer plan and observing events requires read permission. The upstream serializes writers with its private-root lease and enforces owner-scoped cancellation and idempotent request/chunk admission.

The [Desktop component cache contract](../desktop/host-application-component-cache.md) owns cross-device reuse, seven-day idle retention, the 2 GB archive budget, process leases and separate cache/download/transfer presentation.

## Window and permission interaction
Selecting an unavailable application presents preparation for that actual app. An in-flight session-only refresh must not reuse the old unavailable state or prevent the pending window from opening once.

Its bundled helper, native local opening and explicit remote screen-recording/accessibility authorization follow the [macOS contract](macos-host-applications.md); a graphical login is still required.

# Boundaries

Preparation does not install the user's applications or require administrator credentials. Closing a pending viewer withdraws automatic opening, and unqualified staged bytes never become active.

# Evidence

- `internal/hostapps/setup.go`: thin released-library adapter, state placement and complete toolset selection.

- `internal/codeapp/appserver/host_application_setup.go` and `host_applications_test.go`: authenticated status, event and mutation routes.

- `internal/hostapps/linux_desktop.go`: upstream-owned session environment and capability selection.
