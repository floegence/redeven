---
type: Desktop Contract
title: Desktop managed Environment reinstall
description: Direct-channel destructive reinstall, shared progress operation, and target ownership boundaries.
tags: [desktop, reinstall, runtime, gateway, ssh, containers]
timestamp: 2026-08-22T00:00:00Z
---
# Summary

Desktop owns one destructive `reinstall_target` operation for Local, SSH host, Local container, and SSH container Managed Environments. It uses the saved direct host or container channel and never depends on the old Gateway, Runtime, bridge, or state. The operation replaces the exact Redeven `runtime_root`, installs the current Gateway and Runtime packages, verifies the fresh services, and requires no Gateway pairing. A failure after isolation preserves quarantine and enters manual recovery without restarting the old installation.

# Contract

## One operation and one timeline

The click creates a Launcher Operation before preflight, so the existing `EnvironmentProgressPanel` immediately shows the complete ordered plan. Preflight, confirmation, package acquisition, installation, startup, verification, and cleanup retain one `operation_key`. The panel keeps completed, running, and pending steps visible, carries elapsed time and structured diagnostics, and can be reopened from the Environment card after it is closed. Confirmation is a state of the same operation, not a second renderer dialog or a second preflight.

The fixed plan is:

```text
preflight -> confirmation -> target_locked -> sessions_closed
-> maintenance_helper_uploaded -> redeven_processes_inventory
-> redeven_processes_stopping -> redeven_processes_verified_stopped
-> target_quarantined -> gateway_package_preparing
-> gateway_package_installing -> runtime_package_preparing
-> runtime_package_installing -> gateway_and_runtime_starting
-> fresh_identity_verified -> catalog_and_local_ui_verified
-> quarantine_cleaned -> completed
```

Package details identify whether Desktop uploads a verified current bundle or the target downloads from its configured release endpoint. Both paths validate the manifest, version, commit, and digests through the existing package installers.

## Direct-channel ownership

Preflight validates the exact host, SSH identity, container engine and ID, canonical `runtime_root`, and operation quarantine name. A maintenance helper uploaded by Desktop inventories and stops only Redeven processes whose PID, start time, executable path, target root, and parent relationship match the target. Other processes are not inspected or treated as owners of Redeven data. The complete root is atomically moved to an operation-specific quarantine; every file below it is Redeven-owned and is removed only after fresh verification.

The operation does not read, migrate, or call APIs in the quarantined installation. It does not invoke old Gateway APIs, bridge commands, service fallback, broad path deletion, home-directory deletion, container prune, or unregistered volumes. A missing target is a fresh install. A symlink, broad root, changed target, unknown quarantine, or failed stop verification fails closed. Once isolation succeeds, the old installation is never restarted.

## Gateway separation

Managed Environment records live in Environment Target storage and appear only on the Environments page. Their internal Gateway supervisor is an implementation detail and is never projected into Gateway records or paired from Desktop. Standalone Gateways use `redeven-gateway --mode standalone`, own only their URL endpoint and trust/catalog, and never create Runtime binding, Runtime state, or lifecycle APIs. A Gateway-backed Environment is an access-only Environment reached through its explicit URL `access_endpoint`; it does not expose reinstall or Runtime lifecycle controls.

# Boundaries

Redeven clears the exact Desktop-registered root, including Gateway, Runtime, managed packages, workspaces, projects, application data, Floret/ReDevPlugin data, trust, identity, Catalog, and Environment configuration. It retains only channel credentials, target location, and the temporary journal required to complete or recover the operation. It does not delete upstream databases outside the root or inspect unrelated process file descriptors.

# Evidence

- `redeven:desktop/src/shared/desktopReinstallProgress.ts:1` - Canonical reinstall step plan and structured step snapshots.
- `redeven:desktop/src/main/reinstallTargetCoordinator.ts:1` - Exact-target preflight, process inventory, quarantine, fresh install, verification, journal recovery, and fail-closed validation.
- `redeven:desktop/src/main/main.ts:3039` - Current Gateway/Runtime package acquisition and progress mapping through direct host/container executors.
- `redeven:desktop/src/main/main.ts:4481` - Launcher operation journal hydration after Desktop restart.
- `redeven:desktop/src/welcome/App.tsx:9780` - Environment progress panel selection and immediate reinstall progress placeholder.
- `redeven:desktop/src/main/gatewayStore.ts:779` - Gateway Store URL-only standalone record boundary.
- `redeven:cmd/redeven-gateway/main.go:494` - Standalone Gateway startup omits Runtime supervisor and lifecycle state.
- `redeven:desktop/src/main/reinstallTargetCoordinator.test.ts:1` - Exact-root replacement, quarantine retention, changed-target rejection, and direct executor coverage.
