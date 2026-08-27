---
type: Runtime Contract
title: Runtime session permission gates
description: Redeven validates session metadata and clamps granted permissions before opening runtime sessions.
tags: [architecture, security, session-security]
timestamp: 2026-08-27T00:00:00Z
---
# Summary

Before any runtime session is accepted, Redeven validates `session_meta`, rejects unsupported app/channel combinations, intersects the control-plane grant with the local permission policy, and then applies extra app-specific gates for Code App and Port Forward. Protected read-only Runtime observability requires the effective read grant; system-wide process monitoring and process control continue to require execute.

# Contract

## Mechanism

When `grant_server` arrives on the control channel, the runtime checks the channel id, endpoint id, and `floe_app`, resolves the local cap via `PermissionPolicy.ResolveCap`, intersects that cap with the declared read/write/execute grant, writes the clamped flags back into the session snapshot, and refuses Code App or Port Forward sessions that do not satisfy stricter runtime-side requirements. The raw execute bit remains available to explicitly modeled operations such as system-wide process monitoring, process termination, or port forwarding, while a general terminal or arbitrary command process derives a separate effective process-launch capability from `write && execute`.

The protected Runtime process metrics RPC is a narrower read-only exception. It requires `CanRead`, returns only the current Runtime process interval CPU percentage, RSS memory, and sample time, and reads the Monitor service's existing two-second cache. The Monitor service samples one persistent handle opened for its own PID; the RPC does not enumerate processes, expose a PID, guess by process name, or create another polling owner. Runtime version and process start time remain owned by `sys.ping` and are not duplicated in the metrics response.

# Boundaries

Browser or UI-side permission claims remain non-authoritative. Frontend terminal affordances mirror the write-and-execute rule for usability, but Runtime RPC handlers, Terminal RPC, and AI terminal process dispatch remain the authoritative enforcement points. The Env App requests cached Runtime process metrics only while the environment identity tooltip is hovered or keyboard-focused; this lifecycle does not broaden access and does not replace server enforcement. This concept only holds while the runtime continues enforcing local caps plus per-app validation before `runDataSession` starts.

# Evidence

- `redeven:internal/config/permission_policy.go:13` - PermissionPolicy clamps control-plane session metadata to a user-approved local maximum.
- `redeven:internal/agent/agent.go:473` - Unsupported floe_app values are rejected before runtime session startup.
- `redeven:internal/session/types.go:29` - Process launch is allowed only when write and execute are both effective.
- `redeven:internal/ai/run.go:4325` - Hosted terminal command dispatch rechecks the process-launch capability before starting a process.
- `redeven:internal/monitor/service.go:150` - Monitor registers the cached Runtime process metrics endpoint as protected read-only access while retaining execute on system-wide monitoring.
- `redeven:internal/envapp/ui_src/src/ui/EnvironmentRuntimeStatusTooltip.tsx:226` - Env App scopes metrics requests to the active tooltip interaction and preserves partial information on local failures.
