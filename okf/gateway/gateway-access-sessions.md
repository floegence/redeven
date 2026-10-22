---
type: Gateway Contract
title: Gateway access sessions
description: Open member applications over outbound Flowersec connections with isolated end-to-end TLS.
tags: [gateway, desktop, access, security, sessions]
timestamp: 2026-10-07T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Desktop opens a joined Runtime over its existing outbound Flowersec connection to Gateway. Gateway forwards bytes to the Runtime's fixed application entry; it has no Runtime URL to dial. TLS terminates in Desktop and Runtime. Password, MFA, Host/Origin checks and application authorization remain Runtime-owned. Access artifacts limit initial redemption; no Gateway timer shortens established business sessions.

# Contract

## Reverse application streams
After local consent, Runtime redeems its invitation with its own identity and initiates a persistent Flowersec session to the member TLS endpoint. Gateway opens a reverse ByteStream on that Runtime's connection and relays both streams with bounded buffers and cancellation.

TLS, WebSocket, streaming responses and secure cookies retain their original semantics.

## Application and management separation
A reverse stream enters the original public Runtime handler. It never acquires a trusted Desktop management marker.

The catalog alone does not authorize service or Runtime process operations.

## Limits and revocation
The shared budget admits at most 32 business connections per member and 1,024 in total, including pending opens. One member exceeding a limit cannot consume another member's allocation.

Cloud closure receipts and partition limits are owned by [Gateway Cloud access](gateway-cloud-access.md).

# Boundaries

Gateway owns reverse-stream admission and bounded forwarding only. No path in this contract grants Gateway a Runtime lifecycle command, arbitrary egress, or a second direct-access transport.

# Evidence

- `redeven:internal/gatewaymembership/listener.go` — Fixed stream dispatch and SDK relay.

- `redeven:internal/gatewaymembership/runtime_connection.go` — Outbound controller and TLS application listener.

- `redeven:internal/gatewayflow/budget.go` — Shared admission accounting.
