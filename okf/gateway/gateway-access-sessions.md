---
type: Gateway Contract
title: Gateway access sessions
tags: [gateway, desktop, access, security, sessions]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Desktop reaches joined Runtime over its outbound Flowersec Gateway connection; Gateway forwards to fixed application entry without dialing a Runtime URL. Entry expiry never shortens established sessions. Revoking a client closes its live streams and fences its pending artifacts.

# Contract

## Reverse application streams
After local consent, Runtime redeems its invitation with its own identity and initiates a persistent Flowersec session to the unified public TLS endpoint. Gateway opens a reverse ByteStream on that Runtime's connection and relays both streams with bounded buffers and cancellation.

TLS, WebSocket, streaming responses and secure cookies retain their original semantics.

## Application and management separation
A reverse stream enters the original public Runtime handler. It never acquires a trusted Desktop management marker.

The catalog alone does not authorize service or Runtime process operations.

## Limits and revocation
The shared budget admits at most 32 business connections per member and 1,024 in total, including pending opens. One member exceeding a limit cannot consume another member's allocation.

Other clients and the Runtime attachment stay connected. Reauthorization uses a fresh key, so previous artifacts never regain admission. These effects use published Flowersec session cancellation and relay primitives.

Cloud authorization never closes independent Gateway streams. Local egress cancellation is scoped separately by [Optional Runtime Cloud egress](gateway-cloud-access.md).

# Boundaries

Gateway owns reverse-stream admission and bounded forwarding only. No path in this contract grants Gateway a Runtime lifecycle command, arbitrary egress, or a second direct-access transport.

# Evidence

- `redeven:internal/gatewaymembership/listener.go`
- `redeven:internal/gatewayflow/budget.go`
