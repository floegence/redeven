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

## Transport/authentication

Keys bind normalized destination/port, authentication, SSH executable and credential scope. Preserve failures without substitution/replay. macOS/Linux reuse ControlMaster; Windows uses bounded native OpenSSH and one persistent child per private Bridge, no WSL/ControlMaster. Cancel/dispose only owned children.

Omitted passwords reuse exact-scope private credentials, never clear them. Explicit changes reject during leases; no cross-scope inheritance. Without passwords, attempt configured keys/agent in batch mode even for password-mode registration; never send empty retries. Explicit connection allows this; passive status may defer. Password presence grants no authority. Start/Restart/Update carry transient credentials through certificate/access preflight, preparation and verification without saving. Observations reject passwords.

Normalized Connect Timeout bounds connection/probe/inventory/readiness; package/startup keep separate deadlines. Packaged Windows x64 askpass accepts password/passphrase, rejects host-key prompts, emits only private stdout and retains OpenSSH trust. Missing helper fails; secrets never enter argv/files/logs. Bounded SSH includes omit wildcard/negated picker aliases; explicit destinations remain valid. Save exact root/container engine+ID separately from display name.

## Preparation/execution

One operation reuses transport, probes platform once and prepares a small helper only for inventory/stop. Start/Stop never build full packages. Update verifies before mutation; build/download/upload remain visible. Clean builds use published dependencies and install Desktop dependencies before Env App assets.

Archives: ≤256 MiB compressed/512 MiB expanded tar stream including Runtime, Computer and signed plugins. Enforce while decoding before target writes; parse inventory once. Upload uses bounded writes/progress deadline; progressing transfer may exceed command timeout, which resumes after final write. Stall/cancel/loss terminates owned command; pipe progress is not receipt. Credential prompts have no upload deadline.

Shared private slot metadata across upload/install/container/reinstall: runtime, managed, bin and both executables0700; stamp/evidence0600 regardless of umask. Normalization failure preserves live slot; ReDevPlugin owns executable admission.

Host actions use confirmed user/root; container actions inspect exact saved container. Start/Restart/Update/Reinstall may start it; Stop cannot and accepts empty Runtime inventory. Signal verified scope matches only; retain typed before/after. Wipe-reinstall may treat helper inventory/stop as best effort only when direct access can isolate root.

Remote snippets perform one bounded probe/stage/inventory/stop/install/start/verify/isolate/cleanup. Desktop owns ordering/deadlines/cancellation/progress/retry; no remote lock, heartbeat or lifecycle machine.

## Progress/failures

Bootstrap uses generated signed https://github.com/floegence/redeven/releases/latest/download/redeven-install.sh with selected tag; Portal supplies no second installer. One Launcher Operation owns transfers: local upload writes, acquired response bytes with known size, shared acquisition progress. Direct downloads consume complete Downloading Redeven: N% records; stderr is diagnostics, stdout only staged path. Companion output cannot reset Runtime progress.

No extra download/parser process/SSH poll. Transfer100% is not verified install/readiness. Failure/cancel freezes measured progress. Acquisition/directory/upload/unpack are preparation; only activation mutates live slot. Operation exists before first SSH command. Distinguish connection, engine/container, preparation, command and readiness failures with technical stderr. Empty successful startup-report means pending to deadline; nonzero read is command failure, valid blocked report Runtime failure, only nonempty malformed report invalid. Every lifecycle path uses this interpretation.

# Boundaries

SSH registrations retain direct lifecycle menus. Gateway/Provider-only entries cannot borrow them. Never signal unrelated processes, substitute similar containers, delete home directories or prune containers globally. Multiple Desktop processes managing one target are unsupported and do not justify target-side coordination.

# Evidence

- `redeven:desktop/src/main/sshTransportManager.ts:1` - Credential-scoped SSH transport reuse and cancellation.
- `redeven:desktop/native/windows-ssh/main.go:1` - Native Windows askpass prompt and credential boundary.
- `redeven:desktop/src/main/sshTransportManager.test.ts:1` - Platform execution, failure classification, and owned-child disposal.
