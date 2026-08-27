---
type: Runtime Contract
title: Runtime session permission gates
description: Redeven validates session metadata and clamps granted permissions before opening runtime sessions.
tags: [architecture, security, session-security]
timestamp: 2026-08-27T00:00:00Z
---
# Summary

Before any runtime session is accepted, Redeven validates `session_meta`, rejects unsupported app/channel combinations, intersects the control-plane grant with the local permission policy, and then applies extra app-specific gates for Code App and Port Forward. System-wide resource and process monitoring, including the environment status tooltip, continues to require execute; process control does not gain a separate or weaker authority path.

# Contract

## Mechanism

When `grant_server` arrives on the control channel, the runtime checks the channel id, endpoint id, and `floe_app`, resolves the local cap via `PermissionPolicy.ResolveCap`, intersects that cap with the declared read/write/execute grant, writes the clamped flags back into the session snapshot, and refuses Code App or Port Forward sessions that do not satisfy stricter runtime-side requirements. The raw execute bit remains available to explicitly modeled operations such as system-wide process monitoring, process termination, or port forwarding, while a general terminal or arbitrary command process derives a separate effective process-launch capability from `write && execute`.

The Monitor service is the single owner of environment CPU, used and total memory, network, and process sampling. Its existing execute-protected system snapshot RPC reads the two-second cache and does not recollect on request. The environment status tooltip reuses that RPC only while hovered or keyboard-focused and retains a short UI-only trend history; it does not create a Runtime-process endpoint, a second sampler, or another canonical metrics owner. Runtime version and process start time remain owned by `sys.ping` and are not duplicated in the monitor snapshot.

# Boundaries

Browser or UI-side permission claims remain non-authoritative. Frontend terminal and monitoring affordances mirror their effective permission rules for usability, but Runtime RPC handlers, Terminal RPC, and AI terminal process dispatch remain the authoritative enforcement points. Tooltip request lifecycle does not broaden monitor access or replace server enforcement. This concept only holds while the runtime continues enforcing local caps plus per-app validation before `runDataSession` starts.

# Evidence

- `redeven:internal/config/permission_policy.go:13` - PermissionPolicy clamps control-plane session metadata to a user-approved local maximum.
- `redeven:internal/agent/agent.go:473` - Unsupported floe_app values are rejected before runtime session startup.
- `redeven:internal/session/types.go:29` - Process launch is allowed only when write and execute are both effective.
- `redeven:internal/ai/run.go:4325` - Hosted terminal command dispatch rechecks the process-launch capability before starting a process.
- `redeven:internal/monitor/service.go:103` - Monitor keeps the system snapshot RPC behind execute permission.
- `redeven:internal/envapp/ui_src/src/ui/EnvironmentRuntimeStatusTooltip.tsx:314` - Env App scopes metrics requests to the active tooltip interaction and preserves partial information on local failures.
