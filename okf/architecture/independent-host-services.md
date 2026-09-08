---
type: Runtime Contract
title: Independent Host service lifecycle
description: Preserve running applications across management restarts and recover only verified process ownership.
tags: [architecture, managed-services, host, recovery, security]
timestamp: 2026-09-09T00:00:00Z
---
# Summary

- Authority: the application owns its business execution; Redeven owns authorized lifecycle actions, native process identity, launch records, and opening validation.
- Outcome: Desktop or Runtime exit, restart, or upgrade leaves a launched service's PID and launch generation unchanged.
- Invariants: no new binary, resident supervisor, application-specific driver branch, process-output pipe to Runtime, or ownership inferred from PID alone.
- Recovery boundary: absent, mismatched, and uninspectable resources are distinct. Only confirmed absence permits eligible automatic startup; opening failure never stops a running application.

# Independent execution

Host launches in its own session and process group. Its stdin is `/dev/null`; stdout and stderr use the template's declared direct output destination from the first instruction. Go closes unrelated inherited descriptors. The foreground start contract remains: templates must not double-fork, background the application, or retain a permanent wrapper.

A short shell gate waits before executing the template. Runtime obtains native PID and birth identity, creates a private launch record, and persists the identity and applied digest in the Registry before releasing that gate. If Runtime exits before release, pipe EOF ends the gated shell without executing the application. A persisted but unreleased process is observed as absent on recovery. Gate release is the boundary after which management shutdown must preserve the application.

Manager Close cancels its own discovery, maintenance, operations, and opening hooks and releases resources. It does not call Stop on Host, Container, or Compose services. Shutdown interruption is distinct from the user's Cancel action and must bypass cancellation cleanup and transaction rollback that would terminate a running application. Update and reconfiguration retain their existing journals for subsequent recovery. The launch gate also persists a target or rollback identity in the existing update journal before release, so recovery adopts that same PID.

Short opening hooks run in a different session from the application. Their temporary shell lifeline exists only during the bounded invocation and terminates the hook group when Runtime disappears, including forced termination. Hook cancellation and timeout never target the application group. This is not a resident service supervisor or another binary.

# Native identity and recovery

The `host:v3` identity binds service ID, launch nonce, PID, and a digest of native facts:

- macOS: boot-session UUID, kernel process start seconds and microseconds, PID, and user ID;
- Linux: boot ID, process start ticks, PID, user ID, and PID- and user-namespace identity.

New identities never use formatted dates, timezone, command text, or `kern.boottime`. A process must remain its recorded group leader. Every Stop signal rechecks native identity; a missing leader short-circuits signalling, and a reused PID or unavailable inspection fails without signalling an unknown group.

Runtime startup, refresh, and Open share resource observation. Existing running resources are observed without invoking Start or reinstalling them. `desired_state` records the user's intent and is not rewritten by inspection, operation failure, or interruption marking. Current observed running state, opening availability, and previous operation failure are separate facts. An explicit Restart retains running intent during its intermediate Stop. Observation and identity-conversion writes compare the saved launch identity and applied digest, so stale checks cannot overwrite a newer launch. Clean desired-running instances may start only after confirmed absence. Failed or interrupted user operations wait for explicit review or retry.

## Existing instances

A legacy v2 fingerprint that still verifies exactly can be upgraded while its process remains alive. The legacy reader is used only for this conversion; it never guesses changed boot-time values. When exact legacy verification fails, the full-permission management-review API presents the saved PID's native program name, group, user, and birth identity without arguments, environment, or opening credentials. Explicit confirmation supplies the reviewed identity; commit rechecks the same native fingerprint before rebinding. It does not restart or kill the application.

Identity upgrade writes a private journal containing old/new identities and validated opening metadata before the Registry change. Recovery can complete an interruption after the database update and before private session replacement. Existing valid private opening information is preserved and converted into the launch directory. New launches keep opening sessions in their own directories, so a late hook result from a previous generation cannot replace the current entrance. An old process's inherited output descriptors cannot be replaced externally; independent output handling takes effect on its next explicit restart.

# Opening and presentation

A verified running instance owns its applied endpoint and private opening session. Current template changes remain pending until an explicit apply-and-restart action. No executable template snapshot is stored. Open uses the saved verified entrance when the current template differs, and otherwise runs the current authorized opening hooks. Missing opening information, invalid output, or hook failure is retryable without an implicit Restart.

Container and Compose services retain their static declared path, query, and fragment in the same private opening-record format, bound to the applied resource identity and Runtime digest. New starts save that declaration before running; legacy instances without a record initialize it on first observation through their existing static-template resolver. Later template edits cannot overwrite a saved entrance, and a damaged record fails visibly. This grants no Host script execution to either deployment.

The backend provides `actions.open`, `actions.restore_management`, opening state, and pending changes. Renderer uses those capabilities, presents opening failure separately from Running, and retains historical operation diagnostics without making them the current process state. Concurrent Open requests for one service share one hook execution; cancelling one browser request does not cancel another caller's shared work. The existing browser transaction and Desktop window identity suppress duplicate windows.

Endpoint reachability is checked separately from process identity. A running process with an unavailable loopback endpoint remains Running and reports unavailable opening. Runtime-owned proxy connections may be interrupted while Runtime is offline; reopening reconnects through the existing authorized Forward route. The contract does not promise uninterrupted WebSockets, system boot autostart, or application crash supervision.

Template scripts, environment, output modes, hook limits, and URL validation are defined by the [template contract](managed-web-service-templates.md).

# Evidence

- `redeven:internal/managedwebservice/custom_host.go` - Session launch, durable gate, identity verification, and explicit Stop.
- `redeven:internal/managedwebservice/process_identity_darwin.go` - Native macOS boot and birth facts.
- `redeven:internal/managedwebservice/process_identity_linux.go` - Native Linux boot, ticks, user, and namespace facts.
- `redeven:internal/managedwebservice/observation.go` - Common resource observation and separate endpoint availability.
- `redeven:internal/managedwebservice/restore_management.go` - Review and explicit identity rebinding.
- `redeven:internal/managedwebservice/host_identity_upgrade.go` - Resumable identity and private-session conversion.
- `redeven:internal/managedwebservice/open_session_state.go` - Shared private opening records and applied static paths.
- `redeven:internal/managedwebservice/open_session.go` - Shared opening preparation without implicit restart.
- `redeven:internal/managedwebservice/process_boundary_test.go` - Real Runtime exit, forced termination, sustained application output, and hook boundaries.
- `redeven:internal/managedwebservice/host_recovery_test.go` - Reused identity rejection, launch persistence, and private-session recovery.
