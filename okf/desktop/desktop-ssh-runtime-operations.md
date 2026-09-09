---
type: Desktop Contract
title: Desktop SSH runtime operations
description: Direct SSH and SSH-container Runtime lifecycle execution owned by Desktop.
tags: [desktop, ssh, runtime, process]
timestamp: 2026-09-09T00:00:00Z
---
# Summary

Desktop manages an SSH-host or SSH-container Runtime only through the exact saved SSH connection and placement. The same process-local lifecycle coordinator, Launcher Operation, transport lease, platform observation, and temporary helper session serve Start, Stop, Restart, Update, Refresh, Open recovery, and Reinstall. Gateway and Provider credentials are never substituted for SSH authority, and the target stores no Desktop lifecycle lock or supervisor state.

# Contract

## Transport

The SSH transport manager keys a connection by normalized destination, port, authentication mode, SSH binary, and credential scope. A transport failure ends the current command with its original SSH diagnostics; Desktop does not silently select another connection, Gateway, public URL, or Provider route.

macOS and Linux reuse an OpenSSH ControlMaster. Windows uses the same credential-scoped lease contract with independent native OpenSSH processes for bounded commands and one persistent SSH child for each private Runtime Bridge. Windows does not require ControlMaster sockets or WSL to connect to SSH Environments. A nonzero remote command is returned without replay; SSH authentication and transport failures keep their distinct diagnostics. Cancellation and disposal terminate only children owned by that Desktop transport.

Windows password authentication uses the packaged x64 native askpass helper. Each SSH process inherits only its connection's password; the helper accepts password/passphrase prompts, refuses host-key prompts, and writes the answer only to its private standard output. Passwords never enter command arguments, helper files, or logs. Host-key verification remains OpenSSH-owned and enabled. The helper is included separately from the Linux Runtime archive; a missing helper fails password connection visibly.

SSH discovery follows bounded configuration includes, excludes wildcard and negated aliases from selectable entries, and still allows explicit destinations. The Environment registration keeps the display name separate from SSH destination and supplies the exact Runtime root and, for containers, engine and container id.

One lifecycle operation opens or reuses one SSH transport, probes platform once, prepares a lightweight helper only when required, and reuses that session for inventory and stop. Start and Stop do not prepare a full Runtime package. Update prepares the Runtime package independently, verifies it before target modification, and exposes build/download/upload phases separately from process discovery.

Desktop stages every managed Runtime package with private metadata independent of the target user's shell `umask`: `runtime`, `runtime/managed`, and `runtime/managed/bin` are mode `0700`; the `redeven` and `redevplugin-runtime` executables are mode `0700`; and the managed stamp plus ReDevPlugin evidence files are mode `0600`. Upload, remote-install, container, and reinstall paths consume this one slot contract. A metadata-normalization failure leaves the live slot unchanged, while ReDevPlugin remains the final fail-closed executable-admission authority at startup.

## Host and container behavior

SSH-host actions execute against the confirmed remote user and Runtime root. SSH-container actions additionally inspect the saved exact container. Start, Restart, Update, or Reinstall may start that saved container when required; Stop never starts a stopped container and succeeds idempotently when the Runtime inventory is already empty.

Inventory identifies processes by exact Runtime scope and returns typed before/after state. Desktop signals only verified matching processes for ordinary Stop/Restart/Update. Wipe reinstall treats helper inventory and stop as best effort and proceeds to exact-root isolation when SSH and filesystem access remain available.

The remote command snippets each perform one bounded action: probe, stage helper, inventory, stop, install, start, verify, isolate, or cleanup. They do not implement a lifecycle state machine, persist a lock, maintain a heartbeat, or wait on Provider/Gateway authorization. Desktop owns sequence, timeouts, cancellation, progress, and retry.

## User-facing result

The Launcher Operation exists before the first SSH command and reports the actual active phase. SSH connection failure, missing container, unavailable engine, package preparation failure, command exit, and Runtime readiness failure remain distinct structured errors with technical stderr available in details. The session-specific startup-report reader returns an empty successful result until Runtime atomically publishes the report; Desktop treats that state as pending within the existing bounded startup deadline. A nonzero report-read result is a target-command failure, a valid blocked report is a Runtime start failure with the reported reason, and only a nonempty malformed or contract-invalid report is labeled invalid. Start, Restart, Update, Open recovery, and Reinstall consume this one report-availability contract.

An SSH or SSH-container registration always retains its direct lifecycle menu. A Gateway-only or Provider-only Environment has no SSH authority and therefore cannot borrow this execution path.

# Boundaries

Desktop never scans unrelated processes, selects a similarly named container, deletes a home directory, or performs global container cleanup. Multiple Desktop processes controlling one SSH target are unsupported and do not justify a target-side coordination protocol.

# Evidence

- `redeven:desktop/src/main/sshTransportManager.ts:1` - Credential-scoped SSH transport reuse and cancellation.
- `redeven:desktop/native/windows-ssh/main.go:1` - Native Windows askpass prompt and credential boundary.
- `redeven:desktop/src/main/sshTransportManager.test.ts:1` - Platform execution, failure classification, and owned-child disposal.
- `redeven:desktop/src/main/managedRuntimeSlot.ts:1` - Standard managed Runtime file inventory and private metadata contract.
- `redeven:desktop/src/main/sshRuntime.ts:1` - Direct SSH Runtime package, helper, process, start, and verification operations.
- `redeven:desktop/src/main/containerRuntime.ts:1` - Exact SSH-container command construction.
- `redeven:desktop/src/main/runtimeLifecycleCoordinator.ts:1` - One current-Desktop owner per physical target.
- `redeven:desktop/src/main/runtimeLifecycleExecutionPlan.ts:1` - Explicit intent-specific progress phases.
- `redeven:desktop/src/main/reinstallTargetCoordinator.ts:1` - SSH and container final-recovery path.
