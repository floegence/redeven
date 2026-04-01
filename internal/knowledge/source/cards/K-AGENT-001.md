---
id: K-AGENT-001
version: 2
title: Runtime validates session metadata and clamps granted permissions before opening sessions
status: stable
owners:
  - backend
tags:
  - architecture
  - security
  - session_security
source_card_id: K-AGENT-001
---

## Conclusion

Before any runtime session is accepted, Redeven validates `session_meta`, rejects unsupported app/channel combinations, intersects the control-plane grant with the local permission policy, and then applies extra app-specific gates for Code App and Port Forward.

## Mechanism

When `grant_server` arrives on the control channel, the runtime checks the channel id, endpoint id, and `floe_app`, resolves the local cap via `PermissionPolicy.ResolveCap`, intersects that cap with the declared read/write/execute grant, writes the clamped flags back into the session snapshot, and refuses Code App or Port Forward sessions that do not satisfy stricter runtime-side requirements.

## Boundaries

Browser or UI-side permission claims remain non-authoritative. This card only holds while the runtime continues enforcing local caps plus per-app validation before `runDataSession` starts.

## Evidence

- redeven:internal/config/permission_policy.go:13 - PermissionPolicy is documented as clamping control-plane session metadata to a user-approved local maximum.
- redeven:internal/config/permission_policy.go:74 - ResolveCap intersects global, per-user, and per-app caps.
- redeven:internal/agent/agent.go:473 - Unsupported floe_app values are rejected before runtime session startup.
- redeven:internal/agent/agent.go:485 - Granted permissions are intersected with the resolved local cap.
- redeven:internal/agent/agent.go:502 - Effective permissions overwrite the session metadata snapshot used by the runtime.
- redeven:internal/agent/agent.go:508 - Code App sessions require a valid codespace id and full read/write/execute access.
- redeven:internal/agent/agent.go:531 - Port Forward sessions require a valid forward id and execute capability.

## Invalid Conditions

This card becomes invalid if session startup begins trusting browser-side permission state, skips local cap intersection, or stops doing per-app validation before opening data sessions.
