---
type: Runtime Protocol
title: Native Runtime bridge
description: SSH placement for native clients without Desktop management or Runtime startup authority.
tags: [runtime, native, ssh, protocol, security]
timestamp: 2026-10-01T00:00:00Z
---
# Summary

`redeven native-bridge --state-root PATH` attaches a native client to the already running Runtime selected by that state root. The owner-only management socket is the attachment authority. The command carries `redeven-native-runtime-h2/1` over stdio and exposes only the fixed `native-runtime` CONNECT surface. Missing, inaccessible, stopped, or incompatible runtimes fail without installation, startup, address fallback, or Desktop credentials. Disconnecting releases this client's bridge and sessions, never the Runtime process.

# Contract

The command resolves the normal local environment layout, connects to its `0600` Unix management socket, and requests the native protocol upgrade. The running Runtime owns the native HTTP/2 server and its ephemeral IPv4 loopback HTTPDirect endpoint. The command only relays the upgraded socket to stdin/stdout; diagnostics stay on stderr. It requests no PTY, process action, public URL, runtime-control token, or Desktop bridge token.

The native protocol uses the same bounded stdio HTTP/2 transport implementation as Desktop placement, with a distinct handler and identity. `GET /redeven/native/v1/hello` at authority `redeven-native` returns the protocol version, running instance identity, exact WebSocket endpoint, a 256-bit channel token, and its expiry. Hello renews that token's five-minute admission window within the same bridge. Clients validate the selected state root and instance before consuming the endpoint. The endpoint belongs to the remote host; clients carry its bytes through the authenticated SSH channel and must not substitute a local address into the Flowersec artifact.

CONNECT accepts only authority `native-runtime` and requires `X-Redeven-Native-Token`. The destination is captured by the bridge owner, never supplied by the client. Native clients cannot request arbitrary ports, Gateway surfaces, Desktop shutdown, or runtime-control. A bridge allows at most 64 concurrent HTTP/2 streams, 8 KiB header lists, a 256 KiB per-stream receive window, and a 16 MiB connection receive window. The Runtime admits at most 32 simultaneous native bridges. Fifteen idle seconds starts a PING; a missing acknowledgement after ten seconds closes the transport.

# Boundaries

The dedicated loopback application endpoint checks exact authority and the native token, rejects Desktop token headers, and exposes only health, runtime/environment metadata, access status/unlock/logout, and direct artifact issuance/spending. It does not serve browser entry, bootstrap, static application assets, Codespaces, port forwarding, Web Services, or management APIs. The access gate and configured read/write/execute caps remain authoritative. SSH provides the authenticated outer transport for access unlock, including the secure-transport requirement for two-factor authentication; it does not bypass password or second-factor verification.

Native artifact issuance uses Flowersec HTTPDirect and unchanged v3 authorization. Every native access identity is scoped to its bridge and associated with the original access-gate session. Channel activation checks that original owner in the access gate while product session bookkeeping uses the separate native identity. It can never equal `trusted-desktop`. Access revocation cancels attached native bridges; closing a bridge revokes only its own pending/active identities and closes its listener. The WebSocket entry still requires exact endpoint origin and Flowersec's single-use artifact admission, encrypted handshake, and lease. Knowing the loopback port provides no artifact issuance authority.

Business RPC, terminal streams, and product HTTP use the accepted Flowersec session. They do not acquire a second SSH command path. Reconnect creates a new bridge, verifies host and instance identity, and obtains fresh authorization. Clients may restore read projections and terminal attachment; they must not replay commands or writes whose completion is unknown. Native channel tokens, artifacts, grants, and PSKs are transient and must not enter persistent client projections or logs.

# Evidence

- `cmd/redeven/native_bridge.go` owns CLI attachment and failure behavior.
- `internal/nativebridge/` owns the native wire identity and fixed CONNECT authority.
- `internal/stdiobridge/` owns bounded HTTP/2 stdio transport shared with Desktop.
- `internal/localui/native_runtime_bridge.go` owns native endpoint admission and lifetime.
- `internal/localui/localui.go` retains access-gate checks, permission caps, and Flowersec authorization.
- [Runtime access sessions](../security/runtime-access-sessions.md) defines the access-gate owner and revocation boundary.
