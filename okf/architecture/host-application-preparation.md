---
type: Runtime Contract
title: Managed host application preparation
tags: [runtime, desktop, applications, linux, security]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Floe Native Apps acquires, verifies, stages and activates Linux components. Redeven owns routes, placement and progress. Preparation needs no VM/container/package manager/admin password. Runtime upgrades are independent; optional failure preserves compatible installs. Activation requires verification and graphical qualification.

# Contract

- `go.mod` owns exact dependency/toolchain versions. Never combine partial managed/system installations. [Applications](host-applications.md) owns environment restoration, private displays and dependencies.
- Status, explicit transfer-plan inspection and observation require Read. Upstream serializes writers with a private-root lease and owns scoped cancellation/idempotent chunks. [Desktop cache](../desktop/host-application-component-cache.md) owns cross-device reuse, seven-day/2GB policy and separate progress.
- Preparation names the selected app. Session refresh cannot reuse stale unavailable state or suppress its one pending opening. [macOS](macos-host-applications.md) owns helper/local launch/explicit capture-input permission and requires graphical login.

# Boundaries

Preparation never installs user applications. Closing a pending viewer withdraws automatic opening; unqualified staged bytes never activate.

# Evidence

- `internal/hostapps/setup.go`: thin released-library adapter, state placement and complete toolset selection.

- `internal/codeapp/appserver/host_application_setup.go` and `host_applications_test.go`: authenticated status, event and mutation routes.

- `internal/hostapps/linux_desktop.go`: upstream-owned session environment and capability selection.
