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
Desktop probes own at most eight reusable HTTP(S) connections and eight concurrent asset requests; validate every referenced asset within the shared shell deadline, including queue time. Success, failure and cancellation release owned connections. Caller-supplied authenticated Gateway agents retain their route and owner. Readiness diagnostics preserve observed reasons without private bridge credentials; an asset-check failure is not a missing Runtime Service. Bridge limits remain unchanged.

A known openable placement is a dial hint even when its management observation is stale. Open creates a cancelable launcher operation first, then verifies the live bridge and Env App before admission. Unknown/unreachable management state never authorizes Start or Restart. Read-only preflight, connection retries and readiness share a 30-second budget; explicit installation/update keeps its existing lifecycle budget. Bridge establishment has a 15-second deadline and failed owned commands escalate TERM to KILL after one second.

When a bridge fails or repeated upper protocol attempts expose a stall, the SSH owner coalesces a bounded five-second remote `true` probe for the exact generation. Local `-O check` is not peer liveness. Healthy transports remain; failed generations are fenced before owned masters/children are retired. Acquisitions await verification/retirement; late reports cannot kill replacements or other credential scopes. Canceling one verification waiter does not cancel shared verification. Never replay a business command or vary SSH QoS automatically.

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

- `redeven:desktop/src/main/sshTransportManager.ts:1` - Source.
- `redeven:desktop/src/main/sshTransportManager.test.ts:1` - Tests.
- `redeven:desktop/src/main/runtimeProbeConnections.test.ts:1` - Asset capacity, deadlines and cleanup.
