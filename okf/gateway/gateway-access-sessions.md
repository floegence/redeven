---
type: Gateway Contract
title: Gateway access sessions
description: Open member applications over outbound Flowersec connections with isolated end-to-end TLS.
tags: [gateway, desktop, access, security, sessions]
timestamp: 2026-10-07T00:00:00Z
---
# Summary

Desktop opens a joined Runtime over its existing outbound Flowersec connection to Gateway. Gateway forwards bytes to the Runtime's fixed application entry; it has no Runtime URL to dial. TLS terminates in Desktop and Runtime. Password, MFA, Host/Origin checks and application authorization remain Runtime-owned. Access artifacts limit initial redemption; no Gateway timer shortens established business sessions.

# Contract

## Reverse application streams

After local consent, Runtime redeems its invitation with its own identity and initiates a persistent Flowersec session to the member TLS endpoint. The published Flowersec controller owns reconnection and cancellation. A paired Desktop with access permission requests an offer for a current member version. Gateway opens a reverse ByteStream on that Runtime's connection and relays both streams with bounded buffers and cancellation.

The member's signed service descriptor binds its Runtime identity, stable logical HTTPS origin, certificate fingerprint, revision and expiry. Desktop verifies this descriptor, uses a per-session Electron partition and pins only the matching certificate inside that partition. No public DNS for the logical origin, system CA installation, global certificate override, HTML rewriting or Gateway Cookie jar is involved. Runtime need not open a TCP listener.

The Desktop local opaque CONNECT adapter accepts only the fixed member host. It has explicit proxy authentication, no DIRECT fallback and no arbitrary egress. Node application connections and trusted host bridge connections use the published SDK's explicit connection path. Native CodeSpace and Web Service use the same session owner. TLS, WebSocket, streaming responses and secure cookies retain their original semantics.

## Application and management separation

A reverse stream enters the original public Runtime handler. It never acquires a trusted Desktop management marker. Runtime password, MFA and local permission caps apply. The owner-only Unix socket supports local CLI administration when Runtime exposes no TCP listeners. That socket and Desktop private management routes are not mounted on the member application.

The Gateway provides no separate HTTP webpage forwarding URL. LAN applications are opened by Desktop, including browser applications it owns. Independently registered direct URL, SSH or container access remains separate from Gateway membership.

## Limits and revocation

The shared budget admits at most 32 business connections per member and 1,024 in total, including pending opens. Reverse access and Cloud CONNECT use the same budget. One member exceeding a limit cannot consume another member's allocation. Capacity, member state and version are checked before opening; removal closes live member streams.

Closing a Desktop view releases its transport, authentication cache and isolated session. A Gateway process stop ends all paths through it. Removing a member or leaving closes LAN and Cloud access; forbidding Cloud or unpublishing an environment preserves LAN access. Cloud closure receipts and partition limits are owned by [Gateway Cloud access](gateway-cloud-access.md).

# Evidence

- `redeven:internal/gatewaymembership/listener.go` — Fixed stream dispatch and SDK relay.
- `redeven:internal/gatewaymembership/runtime_connection.go` — Outbound controller and TLS application listener.
- `redeven:internal/gatewayflow/budget.go` — Shared admission accounting.
- `redeven:internal/localui/gateway_member_access.go` — Public application boundary without TCP listeners.
- `redeven:internal/localui/owner_socket_control_test.go` — Owner socket authority cannot escape into application requests.
- `redeven:desktop/src/main/gatewayMemberTransport.ts` — Published Node SDK path and exact target enforcement.
- `redeven:desktop/src/main/gatewayMemberPartition.ts` — Per-session certificate and proxy credential scope.
- `redeven:desktop/src/main/gatewayMemberTransport.test.ts` — Go/Node interoperability and cancellation.
