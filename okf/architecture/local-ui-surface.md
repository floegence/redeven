---
type: Runtime Contract
title: Local UI surface
description: Local UI serves browser entrypoints, access-gated APIs, direct sessions, Env App proxying, codespaces, and port forwards.
tags: [architecture, local-ui, runtime, security]
timestamp: 2026-08-30T00:00:00Z
---
# Summary

Redeven Local UI is the Runtime-owned client endpoint. Desktop and browsers can connect concurrently using independent access sessions. Public HTTP/WS or HTTPS/WSS shares one configured port; authenticated Desktop bridge traffic remains on its separate numeric-loopback listener and isolated `flowersec-private-loopback/1` profile. The versioned SQLite authority store is the sole issuer-side source for one-shot Flowersec authorization and browser spend state across all transports. [Local UI network exposure](../security/local-ui-network-exposure.md) owns protocol choice, scope, password, certificate, and migration rules.

# Contract

## Mechanism

`localui.Server` is built with an agent, Code App app server, bind spec, runtime-control socket path, Local Environment identity, diagnostics store, and optional access gate. Its common handler mounts `/api/local/*`, `/_redeven_proxy/*`, `/cs/*`, and `/pf/*`. Password mode protects non-public routes, direct sessions are minted as short-lived Flowersec artifacts, and Runtime responses include the normalized Runtime Service snapshot.

Local UI bind parsing accepts `localhost`, canonical loopback IP literals, concrete non-loopback unicast IPv4 and IPv6 literals, and the `0.0.0.0` and `::` wildcards. It never resolves DNS names. Network exposure requires a fixed port and password authentication; dynamic port `0` remains available only for explicit loopback IP binds. Actual bound interfaces determine the public authority allowlist and complete display URLs. HTTP does not initialize a device CA. HTTPS validates the explicit CA and exact-SAN serving identity and never falls back to HTTP. Runtime startup does not create or trust certificates.

Desktop presentation also starts one private Runtime HTTP listener at `127.0.0.1:0`. It mounts `HandlerForDesktopBridge()`, requires a fresh 256-bit authorization header for the canonical bridge and Electron-owned requests, and serves the exact `/flowersec/v3/direct` WebSocket path through Flowersec's dedicated `flowersec-private-loopback/1` server API after token admission. The same handler accepts a DNS-safe `pf-<forward_id>.localhost:<listener_port>` Host and dispatches it to the existing permission-gated port-forward backend at the application root. Electron partitions authorize that authority with the bridge header. Explicit system-browser access follows the separate [Web Service system-browser authorization](web-service-browser-authorization.md) contract. Both Web Service mechanisms enter this same handler and common proxy; neither falls back to the public Local UI listener, converts to `/pf/<id>`, or introduces a path-prefix router. The private Flowersec profile still accepts only same-origin numeric-loopback `ws:`. The runtime-management socket, `0600` Desktop launch report, and stdio bridge hello carry the machine-only URL and token separately from public URLs. Desktop injects the token only for the canonical bridge origin or exact per-forward virtual authority; renderer projections receive neither value. Env App receives only the exact `desktop_private_bridge_v2` document provenance marker needed to select the private APIs.

The Runtime still owns exactly that one private Local UI listener. A Web Service whose persisted mode is `desktop_loopback` may additionally receive a per-window listener owned by Desktop, not Local UI. That listener binds only `127.0.0.1:0`, admits one random partition credential, and forwards through the authorized private or remote Web Service route above; it cannot call the target service directly or authorize Local UI. Desktop strips the local credential before the protected request, while the Runtime strips its bridge or browser credential before reaching the target. Closing the window or owning Environment session removes the Desktop listener. This compatibility Origin is specified by [Desktop loopback Web Service access](web-service-desktop-loopback.md) and does not create a second Runtime handler, public Local UI address, or Flowersec transport.

Public presentation composes pages and Flowersec at the same actual listener. HTTPS uses TLS 1.3 with normal `flowersec/3` artifacts; HTTP uses the explicit published `flowersec-http-direct/1` APIs. Public reports contain only actual HTTP or HTTPS URLs. DNS names, fake localhost suffixes, alternate IPv4 notation, malformed ports, zones, mapped IPv6, non-loopback private authorities, missing or incorrect bridge authorization, and unlisted public authorities are rejected.

The network server bounds request headers, request bodies, header-read time, read time, write time, idle time, and Flowersec carrier resources. Responses receive CSP frame ancestry, content-type sniffing, referrer, permissions, and same-origin frame headers. Public Flowersec admits only the exact configured origin and protocol. Private Flowersec performs numeric-loopback and same-origin admission after the bridge token check. Runtime-control keeps its target identity, bearer token, and loopback peer checks; its non-browser WebSocket may omit Origin, but any supplied Origin must match its loopback authority.

Before returning a direct connect artifact, Local UI commits one SQLite transaction containing the encrypted `AuthorizationRecord`, immutable handler and access-session binding, artifact and projection digests, the actual validated request origin for launcher/runtime/app, the exact environment target binding, and an HMAC-protected browser spend receipt. The browser uses Floe Webapp's required `commitSpend` callback to commit that receipt through the same-origin spend endpoint before Flowersec sends credential-bearing network traffic. Raw artifacts, plaintext authorization records, receipts, and plugin credentials are not stored in the spend table.

Local UI opens and exactly verifies the versioned store before it creates the Acceptor or starts a listener. Each process start atomically advances `boot_generation`, revokes older pending rows, burns older reservations, releases older leases, and revokes their unspent browser receipts; failure prevents startup. Authorization generates an independent random durable lease, performs an exact `pending -> reserved` CAS, decrypts and parses the row-bound record, calls Flowersec authorization, and commits `reserved -> leased` before allowing the session. Handler resolution reads the immutable binding from that same row. Parse, authorization, or leased-commit failures only burn the authority; Acceptor release is exact-lease scoped, while logout, access expiry, and shutdown may revoke an explicit access-session owner. In-process maps retain only active-session cleanup projections and never authorize a request.

# Boundaries

Public Env App shell GET/HEAD requests may pass before unlock so the login page can load. Local APIs, direct sessions, codespaces, and port-forward routes remain access-gated in password mode. Each browser or Desktop client has its own access-session authority; logout revokes that owner without disrupting peers. Public access conveys no Runtime lifecycle permission.

The private listener accepts only its canonical numeric-loopback Host or a validated per-forward `.localhost` virtual Host. The canonical bridge, mint operation, embedded content, and any Desktop compatibility gateway require separate unforgeable authorities with exact scope; none can authorize another Host, port, forward, partition, or Runtime instance. Browser entries and sessions are bounded, expire in memory, and are never persisted. Runtime-control, Desktop model-source, and management sockets remain loopback or local-socket protected regardless of public exposure. The authority keyring is permission-restricted and separate from SQLite; missing keys, schema drift, future schema versions, and database errors fail closed without state reset.

# Evidence

- `redeven:internal/localui/localui.go:50` - Local UI options require bind, agent, app server, state, runtime-control, version, diagnostics, and access gate inputs.
- `redeven:internal/localui/bind.go:32` - Bind parsing distinguishes loopback, concrete network IP, and wildcard exposure while enforcing fixed network ports.
- `redeven:internal/localui/http_security.go:24` - Listener and interface addresses produce the exact public network authority allowlist and real display URLs.
- `redeven:internal/runtimemanagement/status.go:57` - Runtime attach status requires the machine-only `local_ui_bridge_url` field.
- `redeven:internal/localui/network_server.go` - Public HTTP/WS and HTTPS/WSS share the configured listener.
- `redeven:internal/localui/desktop_browser_handoff.go:1` - The private bridge mints bounded one-use entries and owns exact, in-memory system-browser Web Service sessions.
- `redeven:internal/codeapp/appserver/server.go:6019` - The common Web Service proxy strips Runtime browser credentials from requests and responses while preserving application routing.
- `redeven:internal/localui/authorization_store.go:138` - Store startup loads the separate keyring, migrates and verifies SQLite, and advances the boot generation.
- `redeven:internal/localui/authorization_store.go:284` - Issuance atomically persists encrypted authorization authority and its bound browser spend row.
- `redeven:internal/localui/authorization_store.go:353` - Authorization uses exact reservation, row-bound decryption, parsing, and burned failure convergence.
- `redeven:internal/localui/localui.go:368` - The Acceptor authorizes and resolves handlers through the durable store and releases exact leases.
- `redeven:internal/envapp/ui_src/src/ui/services/controlplaneApi.ts:501` - Local acquisition uses Floe Webapp with the actual page origin, durable spend commit, and exact target validation.
- `redeven:internal/localui/localui_e2e_test.go:1` - Real public and private listeners mint their isolated artifacts, complete Flowersec handshakes, and serve Runtime RPCs.
- `redeven:internal/localui/localui.go:607` - Runtime health carries only the public Local UI URL projection alongside Runtime state.
- `redeven:cmd/redeven/desktop_launch_report.go:123` - The private Desktop launch/status report validates and carries the trusted bridge endpoint.
- `redeven:desktop/src/main/desktopSessionTransport.ts:1` - Native Desktop transport requires the trusted bridge and never selects a public interface address.
- `redeven:desktop/src/main/webServiceLoopbackGateway.ts:1` - Desktop owns the optional per-window local-compatibility Origin while preserving the Runtime route and credential boundary.
