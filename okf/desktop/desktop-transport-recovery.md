---
type: Desktop Contract
title: Desktop transport recovery
description: Bridge registry, recovery snapshots, generation fencing, and session disposal.
tags: [desktop, runtime, transport, recovery]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

Each Desktop bridge session owns an immutable-generation recovery snapshot and one exact registry identity. Recovery validates process, Runtime, protocol, and proxy identity before reusing a session, rejects stale callbacks, and disposes transport/model resources through one terminal settlement path. Health observers may report degradation but cannot independently destroy or recreate the bridge lifecycle.

# Contract

## Mechanism

Each established bridge owns one immutable transport-recovery snapshot with a monotonic `generation` and `revision`, the real `waiting`, `connecting`, `ready`, or `failed` phase, completed attempt count, known retry and recovery timestamps, a structured failure, and explicitly allowed actions. The bridge publishes interruption state before active streams fail and before the stable loopback begins returning its existing 502 response. A manual retry only wakes the current recovery delay; it does not create another recovery loop, replay a request, or acquire an alternate transport. Desktop copies the current snapshot into the owning Env App session, forwards later revisions through the session preload subscription, and resolves snapshot reads and retry commands only from the sending window's WebContents-to-session mapping. Env App cannot read another Environment's recovery state or the broader launcher operation stream.

The bridge registry and the exact `RuntimePlacementBridgeSession` identity are the single transport lifecycle owner. Each registry entry pairs one target and immutable bridge record with either its opening operation or attached Desktop session and one settlement promise. Record updates must still match both the target and session, so a late probe, model-source task, or termination from an old session cannot alter its replacement. `session.closed` is the only automatic registry-removal path. Explicit retirement requests `session.disconnect()` and awaits that same settlement without deleting the record first; the settlement callback alone stops the model source and either publishes terminal failure into the retained Env App shell or finalizes an attached session that is not already closing. Open failure, explicit replacement, window close, destructive lifecycle operations, and Desktop shutdown all use this ordering.

Bridge recovery is generation-safe and process-safe. Runtime recovery requires exact equality of `started_at_unix_ms`, `runtime_version`, runtime-control protocol version, Desktop owner id, and the in-memory runtime-control token. Gateway recovery requires exact equality of normalized state root, executable path, managed service PID, and the in-memory managed bridge token reported by the Gateway desktop-bridge hello. Authentication failure, malformed or incomplete identity, a healthy remote command exit, or any identity mismatch permanently closes the old session and returns control to explicit Open. Recovery never starts, restarts, updates, or stops the remote Runtime or Gateway service.

When bridge recovery reaches a terminal failure, `session.closed` removes the exact registry entry before its single settlement handler stops the session's Desktop model source, clears the Runtime handle and Runtime diagnostics attachment, and retains the already loaded Env App window as a disconnected recovery shell. The terminal snapshot remains available after renderer reload and exposes Connection Center as the next Desktop-owned action. Explicit close marks the window session as closing before retirement, so bridge settlement cannot recursively finalize it a second time. The old Runtime content is not rebound when another process becomes ready. An explicit Open for the same Environment first finalizes the retained failed session, then creates a new window, bridge, and identity boundary.

Welcome runtime health retains the 30-second in-memory freshness TTL and per-record cache identity. Beneath those records, concurrent probes coordinate by physical host, placement/state root, target Runtime release, and password credential scope. A shared physical probe result is projected back onto each saved record's own target id, Environment id, label, host access, and placement, so deduplication never changes provider/runtime target selection. Placement bridge health is a read-only observation with four results: `absent`, `ready`, `recovering`, or `unavailable`. Only `absent` permits remote Runtime or process discovery. A `waiting` or `connecting` recovery snapshot returns `recovering` without a Local UI or runtime-control request. A `ready` snapshot permits the typed Local UI health probe, after which Desktop rechecks both the recovery snapshot and exact registry session identity before updating startup state. Typed probe failure returns `unavailable`, preserves the bridge and last confirmed managed Runtime presence and Provider binding, and never retires transport; a stale result from a replaced or terminated session is discarded. Welcome, Provider occupancy, SSH health, container inspection, and manual refresh consume this observation without acquiring bridge lifecycle write authority. Failed physical tasks are removed after settlement and never become a permanent failure cache.

Desktop treats Runtime Stop, Restart, and Update as terminal boundaries for every Env App session attached to the affected Environment. Once the lifecycle coordinator accepts an SSH or container destructive action, Desktop closes matching windows and the placement bridge before process discovery, stop, package activation, or restart work begins. Provider-link, ordinary window close, application quit, maintenance, authentication failure, and remote process identity change permanently resolve the same bridge record; disconnect closes the current remote bridge command, stable loopback proxy, active sockets, and pending recovery delay. A transient SSH transport loss does not resolve `session.closed`. The lifecycle boundary advances an Environment generation and cancels matching Opens so a late response cannot recreate the Env App. When maintenance starts inside Env App, Desktop opens or focuses Welcome before closing the session. A permanently closed session is never rebound or automatically reopened when the Runtime becomes ready again.

# Boundaries

Transport recovery IPC is a narrow current-session capability. It may expose only the normalized bridge snapshot, its subscription, and the immediate-retry command; it must not expose session keys, other Environment snapshots, Runtime handles, launcher operations, or a way to bind the retained window to a later Runtime identity. Terminal recovery failure may preserve the renderer window for diagnosis and navigation, but every previously loaded Runtime surface must remain non-interactive until the user opens a fresh session.

# Evidence

- `redeven:desktop/src/main/localUIURL.ts:44` - Desktop builds the Env App entry URL under `/_redeven_proxy/env/`.
- `redeven:desktop/src/main/main.ts:8136` - The Desktop Flower bridge allowlist admits the fixed FS path context route.
- `redeven:desktop/src/welcome/flower/localEnvironmentFlowerSurfaceAdapter.tsx:496` - The Desktop Flower adapter reads working-directory path context and list data through the runtime bridge.
- `redeven:internal/localui/localui.go:410` - Runtime starts a separate ephemeral loopback trusted bridge listener.
- `redeven:desktop/src/main/runtimePlacementBridgeSession.ts:337` - SSH and container opens share one framed placement bridge session with a stable loopback handle.
- `redeven:desktop/src/main/sshTransportManager.ts:314` - The Desktop SSH manager lazily acquires host/auth/credential-scoped leases.
- `redeven:desktop/src/main/sshRuntime.ts:1252` - SSH lifecycle phases map a dead fixed-generation lease to the existing interruption presentation.
- `redeven:desktop/src/main/runtimePlacementLoopbackProxy.ts:210` - The stable loopback proxy returns the existing 502 response when no remote bridge transport is attached.
- `redeven:cmd/redeven-gateway/main.go:165` - Gateway desktop-bridge hello publishes the managed service identity over the private stdio bridge.
- `redeven:desktop/src/main/runtimePlacementBridgeRegistry.ts:41` - The registry owns target records, exact session identity, opening/session ownership, and one settlement promise.
- `redeven:desktop/src/main/runtimePlacementBridgeObservation.ts:25` - Read-only bridge observation skips probes during recovery, revalidates session identity, and preserves transport on typed probe failure.
