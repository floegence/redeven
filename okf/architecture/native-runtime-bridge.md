---
type: Runtime Protocol
title: Native Runtime bridge
description: SSH placement for native clients without Desktop management or Runtime startup authority.
tags: [runtime, native, ssh, protocol, security]
timestamp: 2026-10-01T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

`redeven native-bridge --state-root PATH` attaches a native client to the already running Runtime selected by that state root. The owner-only management socket is the attachment authority. The command carries `redeven-native-runtime-h2/1` over stdio and exposes only the fixed `native-runtime` CONNECT surface. Missing, inaccessible, stopped, or incompatible runtimes fail without installation, startup, address fallback, or Desktop credentials. Disconnecting releases this client's bridge and sessions, never the Runtime process.

# Contract

The command resolves the normal local environment layout, connects to its `0600` Unix management socket, and requests the native protocol upgrade.

The native protocol uses the same bounded stdio HTTP/2 transport implementation as Desktop placement, with a distinct handler and identity.

Fifteen idle seconds starts a PING; a missing acknowledgement after ten seconds closes the transport.

# Boundaries

The dedicated loopback application endpoint checks exact authority and the native token, rejects Desktop token headers, and exposes only health, runtime/environment metadata, access status/unlock/logout, and direct artifact issuance/spending. The access gate and configured read/write/execute caps remain authoritative.

Native channel tokens, artifacts, grants, and PSKs are transient and must not enter persistent client projections or logs.

# Evidence

- `cmd/redeven/native_bridge.go` owns CLI attachment and failure behavior.

- `internal/nativebridge/` owns the native wire identity and fixed CONNECT authority.

- `internal/stdiobridge/` owns bounded HTTP/2 stdio transport shared with Desktop.
