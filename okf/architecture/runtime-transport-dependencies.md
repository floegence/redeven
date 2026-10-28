---
type: Runtime Contract
title: Runtime transport dependencies
description: Runtime transport uses Flowersec sessions while terminal lifecycle is delegated to Floeterm managers.
tags: [architecture, dependencies, terminal]
timestamp: 2026-10-08T00:00:00Z
quality_exception: Published Flowersec transport and Floeterm boundary covering session ownership, protocol profiles, and shared admission.
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven runtime builds control and data sessions on the Transport v3 artifact and the current Flowersec lease, connection-controller, session, RPC, and byte-stream primitives, while terminal lifecycle is delegated to Floeterm. Each Env App owns one protocol provider and current Flowersec session; RPC and independent live streams share it. Placement HTTP/2 is a separate SSH stdio boundary and does not change Flowersec wire or public SDK contracts.

# Contract

## AI Flower RPC registration
The local direct and remote agent production session profiles register the complete AI inventory before Flowersec freezes a session. A declared method therefore cannot fail at the router with a missing-handler 404. Stop remains one RPC lifecycle command without a fallback transport.

## Mechanism
The released runtime dependency set includes Floeterm terminal-go v0.19.2 and Flowersec Go v5.11.1.

Env App and Desktop consume Flowersec TypeScript v5.11.1.

Switching a Flower thread, Activity or Workbench mode, terminal view, or file consumer cannot reconnect Flowersec.

Terminal ownership, live framing, history, attachment arbitration, and warmup are specified in [Runtime terminal lifecycle](runtime-terminal-lifecycle.md); this concept only defines the Flowersec/Floeterm dependency boundary and shared transport admission.

# Boundaries

[Web Center](web-environment-center.md) composes the published Flowersec controller with pinned Runtime TLS through an in-process Connector. This adds no new wire protocol and does not replay business requests.

Compatibility depends on these published transport and terminal interfaces staying aligned. Replacing or bypassing them can break placement multiplexing, liveness teardown, bounded RPC, TLS admission, terminal ownership, Presentation ordering, history generation, controller arbitration, or session lifecycle. History and session diagnostics are observability only; neither Redeven nor Floeterm uses session count to reject creation, close a PTY, or pause a running session.

# Evidence

- `redeven:go.mod:10` - Redeven pins floeterm terminal-go in the runtime module.

- `redeven:internal/agent/agent.go:20` - Agent imports the published Flowersec Go v5 root package and uses `ConnectionController`, `WaitForSession`, `Connect`, `Session`, `RPCPeer`, and `ByteStream`.
