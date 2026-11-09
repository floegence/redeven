---
type: Desktop Contract
title: Desktop SSH runtime operations
tags: [desktop, ssh, runtime, process]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Desktop uses saved SSH connection/placement for host/container Runtime. Omitted passwords reuse exact private scope; explicit changes reject during leases and never cross scopes. Without password, explicit connections try configured keys/agent in batch mode even for password registrations; passive status may defer.

# Contract

## Authentication and transport
Keys bind normalized destination/port, authentication, SSH executable and credential scope. Preserve failure without substitution/replay. macOS/Linux use ControlMaster; Windows bounded native OpenSSH plus one child/private Bridge, never WSL/ControlMaster. Cancel only owned children.

Never send empty retries. Start/Restart/Update carry transient credentials through access/certificate checks, preparation and verification without saving; observations reject passwords.

Connect Timeout bounds probe/inventory/readiness; startup/packages have distinct deadlines. Windows x64 askpass accepts password/passphrase, rejects host-key prompts, writes only private stdout and preserves OpenSSH trust. Missing helper fails; no secrets in args/files/logs. Bounded includes exclude wildcard/negated picker aliases, not explicit destinations. Save exact root/container engine+ID separately from label.

## Connection verification and opening
Probes own at most eight reusable HTTP(S) connections and eight concurrent asset requests. Each request has a 1.5-second deadline including queue time; HTML and all asset batches share a separate 15-second deadline. Caller deadlines and cancellation still apply. Transport failure stops further batches; readiness requires every asset. Always release owned connections; preserve caller-owned Gateway agents. Diagnostics retain observed reasons without credentials. Asset failure does not mean a missing Runtime Service; bridge limits remain unchanged.

Known openable placement remains a dial hint when management observations are stale. Open creates a cancelable operation before bridge/Env App verification. Unknown management state never authorizes Start/Restart. Preflight, retries and readiness share 30 seconds; installation/update retain their lifecycle budget. Bridge establishment allows 15 seconds; failed owned commands escalate TERM to KILL after one second.

When a bridge fails or repeated upper protocol attempts expose a stall, the SSH owner coalesces a bounded five-second remote `true` probe for the exact generation. Local `-O check` is not peer liveness. Healthy transports remain; failed generations are fenced before owned masters/children are retired. Acquisitions await verification/retirement; late reports cannot kill replacements or other credential scopes. Canceling one verification waiter does not cancel shared verification. Never replay a business command or vary SSH QoS automatically.

## Execution
One operation reuses transport and probes platform once. Only inventory/stop prepares the small helper; Start/Stop never build full bundles. Update verifies before mutation with visible acquisition/upload/build. Use public dependencies and install Desktop deps before Env assets.

Archive bounds: 256 MiB compressed/512 MiB expanded including Runtime/Computer/signed plugins, enforced before writes and parsed once. Upload progress has its own stall deadline; command timeout resumes after final write. Stall/cancel/loss stops owned command; pipe bytes prove no receipt. Password prompts have no upload deadline.

Private slots: runtime/managed/bin/executables 0700, stamps/evidence 0600 independent of umask. Failed normalization preserves live slot; upstream owns executable admission. Host targets require confirmed user/root, containers exact saved identity. Start/Restart/Update/Reinstall may start container; Stop never does and accepts empty inventory. Signal only verified scope; retain before/after. Wipe-reinstall may tolerate helper inventory/stop failure only when direct access can isolate root.

Remote snippets perform bounded probe/stage/inventory/stop/install/start/verify/isolate/cleanup. Desktop owns order/deadlines/cancel/progress/retry; no target lock/heartbeat/supervisor.

## Progress and results
Use generated signed GitHub latest/download/redeven-install.sh with selected tag, no Portal duplicate. One Launcher Operation measures actual upload/download/acquisition bytes. Parse complete Downloading Redeven: N% records; stderr diagnostics, stdout stage path. Companion output cannot reset Runtime progress. No additional parser/process/poll.

100% transfer proves no readiness. Freeze progress on failure/cancel. Acquisition/staging/upload/unpack prepare; only activation changes the live slot. Create operations before SSH. Distinguish connection/engine/preparation/command/readiness errors with stderr. Empty successful reports remain pending; nonzero reads mean command failure, blocked reports Runtime failure, nonempty malformed reports invalid. All lifecycle paths share interpretation.

# Boundaries

SSH registrations retain direct lifecycle menus. Gateway/Provider-only entries cannot borrow them. Never signal unrelated processes, substitute similar containers, delete home directories or prune containers globally. Multiple Desktop processes managing one target are unsupported and do not justify target-side coordination.

# Evidence

- `redeven:desktop/src/main/sshTransportManager.ts:1` - Source.
- `redeven:desktop/src/main/sshTransportManager.test.ts:1` - Tests.
- `redeven:desktop/src/main/runtimeProbeConnections.test.ts:1` - Delayed batches, per-request/total deadlines, missing assets, cancellation and connection ownership.
