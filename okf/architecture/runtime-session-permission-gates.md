---
type: Runtime Contract
title: Runtime session permission gates
description: Redeven validates session metadata and clamps granted permissions before opening runtime sessions.
tags: [architecture, security, session-security]
timestamp: 2026-08-27T00:00:00Z
---
# Summary

Before any runtime session is accepted, Redeven validates `session_meta`, rejects unsupported app/channel combinations, intersects the control-plane grant with the local permission policy, and then applies extra app-specific gates for Code App and Port Forward. Read permission grants the existing system-monitor snapshot, including process names, users, and resource usage. Process termination remains independently protected by execute permission.

# Contract

## Mechanism

When `grant_server` arrives on the control channel, the runtime checks the channel id, endpoint id, and `floe_app`, resolves the local cap via `PermissionPolicy.ResolveCap`, intersects that cap with the declared read/write/execute grant, writes the clamped flags back into the session snapshot, and refuses Code App or Port Forward sessions that do not satisfy stricter runtime-side requirements. The raw read bit authorizes system-monitor snapshots and other modeled read operations. The raw execute bit remains required for process termination and port forwarding, while a general terminal or arbitrary command process derives a separate effective process-launch capability from `write && execute`.

The Monitor service is the single owner of environment CPU, used and total memory, network, and process sampling. Its existing read-protected system snapshot RPC reads the two-second cache and does not recollect on request. The Monitor page and environment status tooltip consume the same snapshot; the tooltip requests it only while actually open and retains a short UI-only trend history. Neither surface creates another endpoint, sampler, or canonical metrics owner. Runtime version and process start time remain owned by `sys.ping` and are not duplicated in the monitor snapshot.

# Boundaries

Browser or UI-side permission claims remain non-authoritative. The Monitor page and tooltip mirror read permission before requesting snapshots; process-termination controls separately mirror execute permission and stay disabled without it. Runtime RPC handlers, Terminal RPC, and AI terminal process dispatch remain the authoritative enforcement points. Tooltip request lifecycle does not broaden monitor access or replace server enforcement. This concept only holds while the runtime continues enforcing local caps plus per-app validation before `runDataSession` starts.

# Evidence

- `redeven:internal/config/permission_policy.go:13` - PermissionPolicy clamps control-plane session metadata to a user-approved local maximum.
- `redeven:internal/agent/agent.go:473` - Unsupported floe_app values are rejected before runtime session startup.
- `redeven:internal/session/types.go:29` - Process launch is allowed only when write and execute are both effective.
- `redeven:internal/ai/run.go:4325` - Hosted terminal command dispatch rechecks the process-launch capability before starting a process.
- `redeven:internal/monitor/service.go:103` - Monitor protects snapshot reads with read permission and process termination with execute permission.
- `redeven:internal/envapp/ui_src/src/ui/EnvironmentRuntimeStatusTooltip.tsx:314` - Env App scopes metrics requests to the Tooltip open state and preserves valid information after later failures.
