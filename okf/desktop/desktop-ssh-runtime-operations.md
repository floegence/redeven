---
type: Desktop Contract
title: Desktop SSH runtime operations
description: Direct SSH and SSH-container Runtime lifecycle execution owned by Desktop.
tags: [desktop, ssh, runtime, process]
timestamp: 2026-10-13T07:10:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Desktop manages SSH-host and SSH-container Runtime only through the saved connection and placement. One process-local lifecycle coordinator, Launcher Operation, transport lease and temporary helper serve Start, Stop, Restart, Update, Refresh, Open recovery and Reinstall. Gateway/Provider credentials never substitute for SSH authority. The target stores no Desktop lifecycle lock or supervisor state.

# Contract

## Transport and authentication
Connection keys include normalized destination/port, authentication, SSH binary and credential scope. Failure retains SSH diagnostics without route substitution or command replay. macOS/Linux reuse ControlMaster; Windows uses native OpenSSH bounded commands and one persistent child per private Bridge, without WSL or ControlMaster. Cancellation/disposal terminate only owned children.

An omitted acquisition password reuses credentials already held privately by that exact transport scope; it is not a request to replace them with an empty password. Explicit credential changes still reject while leases exist, and other scopes never inherit those credentials. Without an available password, use OpenSSH batch authentication with configured keys or its agent even for a password-mode registration; never submit empty-password retries. Explicit management connection attempts allow this authentication; passive status inspection may defer it when no password is saved. Password availability is not management authority.

One normalized Connect Timeout covers connection, probe, inventory and startup-readiness control; startup/package transfer keep their own deadlines. Windows uses the packaged x64 askpass helper: accept password/passphrase prompts, refuse host-key prompts, emit secrets only through private stdout and retain OpenSSH host-key checks. Passwords never enter arguments, files or logs; missing helper fails visibly.

Discovery follows bounded SSH includes and excludes wildcard/negated aliases from selection, while explicit destinations remain allowed. Registrations separate display name from destination and save exact root and container engine/id.

## Preparation
One operation reuses its transport, probes platform once and prepares a lightweight helper only as needed for inventory/stop. Start/Stop never prepare a full package. Update independently verifies its package before modification; build/download/upload remain visible preparation phases. Clean-source builds use published dependencies and install Desktop dependencies before Env App assets; existing `node_modules` is not a prerequisite.

Archives allow 256 MiB compressed and 512 MiB for the complete expanded tar stream, including Runtime, Computer suite and signed plugins. Enforce expansion while decoding, before target modification, and reuse one parsed inventory.

Bulk upload uses bounded writes and a progress deadline; continuous progress may exceed command timeout, stalled writes terminate the owned command, and command completion timeout resumes after the last write. Pipe progress is not remote receipt. Cancellation/loss remains authoritative; administrator credential input never uses this deadline.

All upload/install/container/reinstall paths share private slot metadata: `runtime`, `runtime/managed`, `runtime/managed/bin` and both executables use `0700`; stamp/evidence use `0600`, independent of umask. Normalization failure preserves the live slot; ReDevPlugin owns final executable admission.

## Exact target execution
Host actions use the confirmed remote user/root; container actions inspect the saved exact container. Start/Restart/Update/Reinstall may start it; Stop never does and succeeds on empty Runtime inventory. Signal only verified scope matches and retain typed before/after state. Wipe reinstall treats helper inventory/stop as best effort when direct filesystem access can still isolate the root.

Remote snippets perform one bounded probe, stage, inventory, stop, install, start, verify, isolate or cleanup action. Desktop owns ordering, deadlines, cancellation, progress and retry; there is no remote lock, heartbeat or lifecycle machine.

## Progress and failures
Direct bootstrap uses the generated signed `https://github.com/floegence/redeven/releases/latest/download/redeven-install.sh` with the explicit selected tag; Portal is not another installer. Transfers stay within one Launcher Operation task: uploads count local pipe writes, acquisition counts response bytes with usable content length, and shared cached acquisitions share progress. Direct downloads consume complete installer `Downloading Redeven: N%` records. Installer diagnostics use stderr; stdout carries only the staged path. Companion output cannot reset Runtime progress.

No second download, progress-parser subprocess or SSH polling command is allowed. 100% transfer is not verified installation/readiness; preparation remains active through staged verification. Cancellation/failure freezes measured progress. Acquisition, staging-directory creation, upload and unpacking are preparation; only activation changes the live slot.

The operation exists before its first SSH command. Connection, engine/container, preparation, command and readiness failures remain distinct with technical stderr. Empty successful startup-report reads mean pending until the bounded deadline; nonzero reads mean command failure, valid blocked reports mean Runtime failure, and only nonempty malformed reports are invalid. All lifecycle paths share this interpretation.

# Boundaries

SSH registrations retain direct lifecycle menus. Gateway/Provider-only entries cannot borrow them. Never signal unrelated processes, substitute similar containers, delete home directories or prune containers globally. Multiple Desktop processes managing one target are unsupported and do not justify target-side coordination.

# Evidence

- `redeven:desktop/src/main/sshTransportManager.ts:1` - Credential-scoped SSH transport reuse and cancellation.
- `redeven:desktop/native/windows-ssh/main.go:1` - Native Windows askpass prompt and credential boundary.
- `redeven:desktop/src/main/sshTransportManager.test.ts:1` - Platform execution, failure classification, and owned-child disposal.
- `redeven:desktop/src/main/managedRuntimeSlot.ts:1` - Standard managed Runtime file inventory and private metadata contract.
- `redeven:desktop/src/main/sshRuntime.ts:1` - Direct SSH Runtime package, helper, process, start, and verification operations.
- `redeven:desktop/src/main/runtimeTransferProgress.ts:1` - Bounded transfer observation and upload event frequency.
- `redeven:desktop/src/welcome/RuntimeComponentTransferProgress.tsx:1` - Localized determinate and indeterminate transfer meters.
- `redeven:desktop/src/main/runtimeArchive.ts:1` and `redeven:desktop/src/main/runtimeArchive.test.ts:1` - Bounded package expansion and complete-suite admission.
- `redeven:desktop/src/main/containerRuntime.ts:1` - Exact SSH-container command construction.
- `redeven:desktop/src/main/runtimeLifecycleCoordinator.ts:1` - One current-Desktop owner per physical target.
- `redeven:desktop/src/main/runtimeLifecycleExecutionPlan.ts:1` - Explicit intent-specific progress phases.
- `redeven:desktop/src/main/reinstallTargetCoordinator.ts:1` - SSH and container final-recovery path.
