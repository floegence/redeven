---
type: Runtime Contract
title: Runtime session permission gates
description: Redeven validates session metadata and clamps granted permissions before opening runtime sessions.
tags: [architecture, security, session-security]
timestamp: 2026-06-17T00:00:00Z
---

Before any runtime session is accepted, Redeven validates `session_meta`, rejects unsupported app/channel combinations, intersects the control-plane grant with the local permission policy, and then applies extra app-specific gates for Code App and Port Forward.

# Mechanism

When `grant_server` arrives on the control channel, the runtime checks the channel id, endpoint id, and `floe_app`, resolves the local cap via `PermissionPolicy.ResolveCap`, intersects that cap with the declared read/write/execute grant, writes the clamped flags back into the session snapshot, and refuses Code App or Port Forward sessions that do not satisfy stricter runtime-side requirements.

# Boundaries

Browser or UI-side permission claims remain non-authoritative. This concept only holds while the runtime continues enforcing local caps plus per-app validation before `runDataSession` starts.

# Citations

[1] redeven:internal/config/permission_policy.go:13 - PermissionPolicy clamps control-plane session metadata to a user-approved local maximum.
[2] redeven:internal/config/permission_policy.go:74 - ResolveCap intersects global, per-user, and per-app caps.
[3] redeven:internal/agent/agent.go:473 - Unsupported floe_app values are rejected before runtime session startup.
[4] redeven:internal/agent/agent.go:485 - Granted permissions are intersected with the resolved local cap.
[5] redeven:internal/agent/agent.go:502 - Effective permissions overwrite the session metadata snapshot used by the runtime.
[6] redeven:internal/agent/agent.go:508 - Code App sessions require a valid codespace id and full read/write/execute access.
[7] redeven:internal/agent/agent.go:531 - Port Forward sessions require a valid forward id and execute capability.
