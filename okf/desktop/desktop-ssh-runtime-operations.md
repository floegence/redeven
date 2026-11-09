---
type: Desktop Contract
title: Desktop SSH runtime operations
tags: [desktop, ssh, runtime, process]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Desktop uses saved SSH connection/placement for host/container Runtime. Omitted password reuses exact private scope; changes fail during leases and never cross scopes. Explicit passwordless opens try configured keys/agent in batch mode even for password registrations; passive observations may defer.

# Contract

## Authentication and transport
Transport keys bind normalized destination/port/authentication/executable/credential scope. Preserve failure without substitution/replay. macOS/Linux use ControlMaster; Windows uses bounded native OpenSSH plus one child/private Bridge, never WSL/ControlMaster. Cancel owned children only.

No empty retry. Start/Restart/Update retain transient credentials through access/certificate/preparation/verification, never save; observations reject passwords. Probe/inventory/readiness use Connect Timeout, package/startup separate budgets. Windows x64 private-stdout askpass accepts passwords/passphrases, rejects host-key prompts and preserves trust; missing helper fails without secret args/files/logs. Bounded includes omit wildcard/negated picker aliases, not explicit destinations. Persist exact root/container engine+ID apart from label.

## Connection verification and opening
Probes own at most eight reusable HTTP(S) connections and eight concurrent asset requests. Each request has a 1.5-second deadline including queue time; HTML and all asset batches share a separate 15-second deadline. Caller deadlines and cancellation still apply. Transport failure stops further batches; readiness requires every asset. Always release owned connections; preserve caller-owned Gateway agents. Diagnostics retain observed reasons without credentials. Asset failure does not mean a missing Runtime Service; bridge limits remain unchanged.

Known openable placement remains a dial hint when management observations are stale. Open creates a cancelable operation before bridge/Env App verification. Unknown management state never authorizes Start/Restart. Preflight, retries and readiness share 30 seconds; installation/update retain their lifecycle budget. Bridge establishment allows 15 seconds; failed owned commands escalate TERM to KILL after one second.

Failed bridge/repeated upper stall triggers coalesced5s remote true for exact generation; local -O check proves no peer liveness. Preserve healthy transport; fence failures before retiring owned masters/children. Acquisitions wait for verification/retirement; late reports cannot kill replacements/scopes. Canceling one waiter retains shared verification. Never replay business commands or vary QoS automatically.

## Execution
One operation reuses transport/probes platform once. Only inventory/stop prepares small helper; Start/Stop never build bundles. Update verifies before mutation and exposes acquisition/upload/build. Use public dependencies; install Desktop deps before Env assets.

Parse archives once before writes with256MiB compressed/512MiB expanded bound, including Runtime/Computer/signed plugins. Upload has independent stall deadline; command timeout resumes after final write. Stall/cancel/loss stops owned command; pipe bytes prove no receipt. Password prompts have no upload deadline.

Private Runtime/managed/bin/executables0700, evidence/stamps0600 regardless of umask. Normalization failure preserves live slot; upstream admits executables. Host identity needs confirmed user/root, container exact saved ID. Start/Restart/Update/Reinstall may start container; Stop never does and accepts empty inventory. Signal verified scope only, retain before/after. Wipe may tolerate helper inventory/stop failure only if direct access isolates root.

Remote bounded snippets perform probe/stage/inventory/stop/install/start/verify/isolate/cleanup. Desktop owns order/deadlines/cancel/progress/retry; no target lock/heartbeat/supervisor.

## Progress and results
Use generated signed GitHub installer at selected tag, no Portal duplicate. Existing Launcher measures actual acquisition/transfer; parse complete Downloading Redeven:N% records, stderr diagnostics/stdout stage path. Companion output cannot reset Runtime progress; no extra parser/process/poll.100% proves no activation/readiness. Freeze failure/cancel progress; only activation changes live slot.

Create operation before SSH. Distinguish connection/engine/preparation/command/readiness with technical stderr. Empty success stays pending until deadline; nonzero read=command failure, valid blocked report=Runtime failure, only nonempty malformed=invalid. All lifecycle paths share interpretation.

# Boundaries

Only direct SSH registrations expose lifecycle; Gateway/Provider entries borrow none. Never signal unrelated processes, substitute containers, delete home or prune globally. Multiple Desktop owners of one target remain unsupported, not reason for remote coordination.

# Evidence

desktop/src/main/sshTransportManager.ts and adjacent tests own transport; runtimeProbeConnections.test.ts covers delayed batches, request/total deadlines, missing assets, cancellation and connection cleanup.
