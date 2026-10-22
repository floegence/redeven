---
type: Runtime Contract
title: Runtime session permission gates
description: Redeven validates session metadata and clamps granted permissions before opening runtime sessions.
tags: [architecture, security, session-security]
timestamp: 2026-10-16T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Before any runtime session is accepted, Redeven validates `session_meta`, rejects unsupported app/channel combinations, intersects the control-plane grant with the local permission policy, and then applies extra app-specific gates for Code App and Port Forward. Read permission grants the existing system-monitor snapshot, including process names, users, and resource usage. Process termination remains independently protected by execute permission.

# Contract

## Mechanism
When `grant_server` arrives on the control channel, the runtime checks the channel id, endpoint id, and `floe_app`, resolves the local cap via `PermissionPolicy.ResolveCap`, intersects that cap with the declared read/write/execute grant, writes the clamped flags back into the session snapshot, and refuses Code App or Port Forward sessions that do not satisfy stricter runtime-side requirements.

Resource sampling, cached presentation, network accounting, and recovery are owned by the [runtime system monitoring contract](runtime-system-monitoring.md).

# Boundaries

Browser or UI-side permission claims remain non-authoritative. This concept only holds while the runtime continues enforcing local caps plus per-app validation before `runDataSession` starts.

# Evidence

- `redeven:internal/config/permission_policy.go:13` - PermissionPolicy clamps control-plane session metadata to a user-approved local maximum.

- `redeven:internal/agent/agent.go:473` - Unsupported floe_app values are rejected before runtime session startup.

- `redeven:internal/session/types.go:29` - Process launch is allowed only when write and execute are both effective.
