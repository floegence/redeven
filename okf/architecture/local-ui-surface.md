---
type: Runtime Contract
title: Local UI surface
description: Local UI serves browser entrypoints, access-gated APIs, direct sessions, Env App proxying, codespaces, and port forwards.
tags: [architecture, local-ui, runtime, security]
timestamp: 2026-07-17T00:00:00Z
---
# Summary

Redeven Local UI is the browser-facing endpoint runtime surface. It exposes the Env App proxy, Local UI status APIs, direct Flowersec session handoff, Browser Editor codespace routes, and port-forward routes through an HTTPS server. Its versioned SQLite authority store is the sole issuer-side source for one-shot Flowersec authorization and browser spend state, while an explicitly generated device CA anchors HTTPS and WSS and must be trusted by each actual browser or client.

# Contract

## Mechanism

`localui.Server` is built with an agent, Code App app server, bind spec, runtime-control socket path, Local Environment identity, diagnostics store, and optional access gate. The HTTPS handler mounts `/api/local/*`, `/_redeven_proxy/*`, `/cs/*`, and `/pf/*`; Flowersec WSS is served by an independent SDK-owned listener at `/flowersec/v3/direct`. Password mode protects non-public routes, direct sessions are minted as short-lived Flowersec v3 connect artifacts, and runtime responses include the normalized Runtime Service snapshot.

Local UI bind parsing accepts `localhost`, canonical loopback IP literals, concrete non-loopback unicast IPv4 and IPv6 literals, and the `0.0.0.0` and `::` wildcards. It never resolves DNS names. Network exposure requires a fixed port and password authentication; dynamic port `0` remains available only for explicit loopback IP binds. Wildcard startup enumerates active, non-loopback, same-family unicast interface addresses, excludes unspecified, multicast, link-local, zoned, and IPv4-mapped IPv6 addresses, sorts them deterministically, and fails when no real access address remains. Startup also fails when the Local UI device CA identity or generated exact-SAN leaf is missing, invalid, or expired. Runtime validates that serving identity and starts HTTPS/WSS, but never generates the CA, installs client trust, invokes `sudo`, or treats a Runtime-side trust-store probe as proof that the actual browser or client trusts it.

Runtime starts three listener boundaries. Public Local UI authorities are served with TLS 1.3 HTTPS. Each public listener has a separately allocated TLS 1.3 WSS listener owned by Flowersec, and each UI authority maps to exactly one WSS authority in the minted v3 artifact. A separate private HTTP listener binds `127.0.0.1:0`, mounts `HandlerForDesktopBridge()`, and requires a fresh 256-bit authorization header on every request. The bridge may mint artifacts for the configured WSS authority but never serves a parallel Flowersec route. The private runtime-management socket, `0600` Desktop launch report, and stdio bridge hello carry the machine-only URL and token. Desktop injects the token only for requests to the exact private bridge origin and records diagnostics before injection; renderer projections receive neither value. The Env App receives only the exact `desktop_private_bridge_v1` document provenance marker needed to accept its numeric-loopback HTTP document. Public startup events, health, access status, catalogs, display URLs, preferences, and ordinary browser clients expose only HTTPS URLs. DNS names, fake localhost suffixes, alternate IPv4 notation, malformed ports, zones, mapped IPv6, non-loopback authorities, missing or incorrect bridge authorization, and unlisted public authorities are rejected.

The network server bounds request headers, request bodies, header-read time, read time, write time, idle time, and Flowersec carrier resources. Responses receive CSP frame ancestry, content-type sniffing, referrer, permissions, and same-origin frame headers. Flowersec performs WSS Origin admission against exact configured HTTPS origins plus the exact trusted bridge origin. Runtime-control keeps its target identity, bearer token, and loopback peer checks; its non-browser WebSocket may omit Origin, but any supplied Origin must still match its loopback authority.

Before returning a direct connect artifact, Local UI commits one SQLite transaction containing the encrypted `AuthorizationRecord`, immutable handler and access-session binding, artifact and projection digests, the actual validated request origin for launcher/runtime/app, the exact environment target binding, and an HMAC-protected browser spend receipt. The browser uses Floe Webapp's required `commitSpend` callback to commit that receipt through the same-origin spend endpoint before Flowersec sends credential-bearing network traffic. Raw artifacts, plaintext authorization records, receipts, and plugin credentials are not stored in the spend table.

Local UI opens and exactly verifies the versioned store before it creates the Acceptor or starts a listener. Each process start atomically advances `boot_generation`, revokes older pending rows, burns older reservations, releases older leases, and revokes their unspent browser receipts; failure prevents startup. Authorization generates an independent random durable lease, performs an exact `pending -> reserved` CAS, decrypts and parses the row-bound record, calls Flowersec authorization, and commits `reserved -> leased` before allowing the session. Handler resolution reads the immutable binding from that same row. Parse, authorization, or leased-commit failures only burn the authority; Acceptor release is exact-lease scoped, while logout, access expiry, and shutdown may revoke an explicit access-session owner. In-process maps retain only active-session cleanup projections and never authorize a request.

# Boundaries

Local UI route behavior is part of the runtime trust boundary. Public Env App shell GET/HEAD requests may pass before local unlock so the shell can load, but local APIs, direct sessions, codespaces, and port-forward routes stay access-gated when password mode is enabled. HTTPS and WSS use short-lived leaf certificates with exact configured SANs and a TLS 1.3 minimum. A missing or invalid serving identity prevents startup; a browser or client that has not imported the public CA fails its TLS connection closed. Another authority, an origin mismatch, or an unavailable WSS listener also fails explicitly; there is no public HTTP, WS, v2, or dual-stack fallback. The private Desktop HTTP listener is not a public transport or compatibility fallback: it requires both the exact numeric-loopback endpoint and unforgeable per-process authorization retained by Desktop. Native Desktop, SSH, and container paths must not replace it with the public listener. Runtime-control, Desktop model-source, and runtime management sockets remain loopback or local-socket protected regardless of Local UI exposure. The authority keyring is permission-restricted and separate from SQLite; missing keys, schema drift, future schema versions, and database errors fail closed without state reset.

# Evidence

- `redeven:internal/localui/localui.go:50` - Local UI options require bind, agent, app server, state, runtime-control, version, diagnostics, and access gate inputs.
- `redeven:internal/localui/bind.go:32` - Bind parsing distinguishes loopback, concrete network IP, and wildcard exposure while enforcing fixed network ports.
- `redeven:internal/localui/http_security.go:24` - Listener and interface addresses produce the exact public network authority allowlist and real display URLs.
- `redeven:internal/runtimemanagement/status.go:57` - Runtime attach status requires the machine-only `local_ui_bridge_url` field.
- `redeven:internal/localui/secure_server.go:18` - Runtime configures exact TLS certificate hosts and independent Flowersec WSS listeners.
- `redeven:internal/localui/localui.go:1677` - Direct endpoint construction maps one verified HTTPS authority to its WSS authority.
- `redeven:internal/localui/authorization_store.go:138` - Store startup loads the separate keyring, migrates and verifies SQLite, and advances the boot generation.
- `redeven:internal/localui/authorization_store.go:284` - Issuance atomically persists encrypted authorization authority and its bound browser spend row.
- `redeven:internal/localui/authorization_store.go:353` - Authorization uses exact reservation, row-bound decryption, parsing, and burned failure convergence.
- `redeven:internal/localui/localui.go:368` - The Acceptor authorizes and resolves handlers through the durable store and releases exact leases.
- `redeven:internal/envapp/ui_src/src/ui/services/controlplaneApi.ts:501` - Local acquisition uses Floe Webapp with the actual page origin, durable spend commit, and exact target validation.
- `redeven:internal/localui/localui_e2e_test.go:29` - A real HTTPS localhost listener mints a WSS v3 artifact, completes the Flowersec handshake, and serves monitor and filesystem RPCs.
- `redeven:internal/localui/localui.go:607` - Runtime health carries only the public Local UI URL projection alongside Runtime state.
- `redeven:cmd/redeven/desktop_launch_report.go:123` - The private Desktop launch/status report validates and carries the trusted bridge endpoint.
- `redeven:desktop/src/main/desktopSessionTransport.ts:1` - Native Desktop transport requires the trusted bridge and never selects a public interface address.
