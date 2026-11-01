---
type: Runtime Contract
title: Runtime session permission gates
tags: [architecture, security, session-security]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Runtime validates session metadata and supported app/channel pairs before intersecting control-plane and local policy. Code App and Port Forward add their own gates. Read permits existing monitor/process observations; process termination independently requires execute and cannot inherit authority from visibility.

# Contract

## Mechanism
When `grant_server` arrives on the control channel, the runtime checks the channel id, endpoint id, and `floe_app`, resolves the local cap via `PermissionPolicy.ResolveCap`, intersects that cap with the declared read/write/execute grant, writes the clamped flags back into the session snapshot, and refuses Code App or Port Forward sessions that do not satisfy stricter runtime-side requirements.

Resource sampling, cached presentation, network accounting, and recovery are owned by the [runtime system monitoring contract](runtime-system-monitoring.md).

# Boundaries

Browser or UI-side permission claims remain non-authoritative. This concept only holds while the runtime continues enforcing local caps plus per-app validation before `runDataSession` starts.

# Evidence

- `redeven:internal/config/permission_policy.go:13` - Control-plane permission intersected with user-approved local cap.

- `redeven:internal/session/types.go:29` - Process launch needs both write and execute.
