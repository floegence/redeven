---
id: K-AGENT-001
version: 1
title: Agent session permissions are enforced by control metadata and local policy
status: stable
owners:
  - backend
tags:
  - architecture
  - security
  - control_plane
source_card_id: K-AGENT-001
---

## Conclusion

The agent accepts control-plane session metadata and always clamps granted permissions with the local permission policy before serving a session.

## Mechanism

When a grant arrives, the runtime validates channel and app metadata, intersects granted read/write/execute permissions with the local cap, and persists the effective permission set into the session snapshot.

## Boundaries

Any attempt to trust browser-reported permissions instead of the session metadata and local cap would bypass endpoint-side permission enforcement.

## Evidence

- redeven-agent:README.md:106 - The security model states that browser-claimed permissions are not trusted.
- redeven-agent:internal/agent/agent.go:430 - Unsupported floe_app values are rejected before session setup.
- redeven-agent:internal/agent/agent.go:435 - Permission clamp intersects grants with local policy.
- redeven-agent:internal/agent/agent.go:459 - Effective permissions overwrite session metadata fields.

## Invalid Conditions

This card becomes invalid if session startup skips permission intersection or starts accepting browser-side permission claims as authoritative.
