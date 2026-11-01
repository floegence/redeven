---
type: Desktop Contract
title: Desktop SSH runtime operations
tags: [desktop, ssh, runtime, process]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Desktop manages SSH-host and SSH-container Runtime only through the saved connection and placement. One process-local lifecycle coordinator, Launcher Operation, transport lease and temporary helper serve Start, Stop, Restart, Update, Refresh, Open recovery and Reinstall. Gateway/Provider credentials never substitute for SSH authority. The target stores no Desktop lifecycle lock or supervisor state.

# Contract

## Authentication and transport
Keys bind normalized destination/port, authentication, SSH executable and credential scope. Preserve failure without substitution/replay. macOS/Linux use ControlMaster; Windows bounded native OpenSSH plus one child/private Bridge, never WSL/ControlMaster. Cancel only owned children.

Omitted passwords reuse exact private scope; explicit changes reject during leases and never cross scopes. Without password, explicit connections try configured keys/agent in batch mode even for password registrations; passive status may defer. Never send empty retries. Start/Restart/Update carry transient credentials through access/certificate checks, preparation and verification without saving; observations reject passwords.

Connect Timeout bounds probe/inventory/readiness; startup/packages have distinct deadlines. Windows x64 askpass accepts password/passphrase, rejects host-key prompts, writes only private stdout and preserves OpenSSH trust. Missing helper fails; no secrets in args/files/logs. Bounded includes exclude wildcard/negated picker aliases, not explicit destinations. Save exact root/container engine+ID separately from label.

## Execution
One operation reuses transport and probes platform once. Only inventory/stop prepares the small helper; Start/Stop never build full bundles. Update verifies before mutation with visible acquisition/upload/build. Use public dependencies and install Desktop deps before Env assets.

Archive bounds: 256 MiB compressed/512 MiB expanded including Runtime/Computer/signed plugins, enforced before writes and parsed once. Upload progress has its own stall deadline; command timeout resumes after final write. Stall/cancel/loss stops owned command; pipe bytes prove no receipt. Password prompts have no upload deadline.

Private slots: runtime/managed/bin/executables 0700, stamps/evidence 0600 independent of umask. Failed normalization preserves live slot; upstream owns executable admission. Host targets require confirmed user/root, containers exact saved identity. Start/Restart/Update/Reinstall may start container; Stop never does and accepts empty inventory. Signal only verified scope; retain before/after. Wipe-reinstall may tolerate helper inventory/stop failure only when direct access can isolate root.

Remote snippets perform bounded probe/stage/inventory/stop/install/start/verify/isolate/cleanup. Desktop owns order/deadlines/cancel/progress/retry; no target lock/heartbeat/supervisor.

## Progress and results
Use generated signed GitHub latest/download/redeven-install.sh with selected tag, no Portal duplicate. One Launcher Operation measures actual upload/download/acquisition bytes. Parse complete Downloading Redeven: N% records; stderr diagnostics, stdout stage path. Companion output cannot reset Runtime progress. No additional parser/process/poll.

100% transfer proves no activation/readiness. Freeze measured progress on failure/cancel. Acquisition/staging/upload/unpack are preparation; only activation changes live slot. Create operation before first SSH command. Distinguish connection/engine/preparation/command/readiness errors with technical stderr. Empty successful report stays pending to deadline; nonzero read is command failure, valid blocked report Runtime failure, only nonempty malformed report invalid. All lifecycle paths share interpretation.

# Boundaries

SSH registrations retain direct lifecycle menus. Gateway/Provider-only entries cannot borrow them. Never signal unrelated processes, substitute similar containers, delete home directories or prune containers globally. Multiple Desktop processes managing one target are unsupported and do not justify target-side coordination.

# Evidence

- `redeven:desktop/src/main/sshTransportManager.ts:1` - Credential-scoped SSH transport reuse and cancellation.
- `redeven:desktop/native/windows-ssh/main.go:1` - Native Windows askpass prompt and credential boundary.
- `redeven:desktop/src/main/sshTransportManager.test.ts:1` - Platform execution, classification and owned cleanup.
