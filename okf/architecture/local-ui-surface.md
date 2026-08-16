---
type: Runtime Contract
title: Local UI surface
description: Local UI serves browser entrypoints, access-gated APIs, direct sessions, Env App proxying, codespaces, and port forwards.
tags: [architecture, local-ui, runtime, security]
timestamp: 2026-07-17T00:00:00Z
---
# Summary

Redeven Local UI is the browser-facing endpoint runtime surface. It exposes the Env App proxy, Local UI status APIs, direct Flowersec session handoff, Browser Editor codespace routes, and port-forward routes from the same runtime-managed HTTP server. Its versioned SQLite authority store is the sole issuer-side source for one-shot Flowersec authorization and browser spend state.

# Contract

## Mechanism

`localui.Server` is built with an agent, Code App app server, bind spec, runtime-control socket path, Local Environment identity, diagnostics store, and optional access gate. The handler mounts `/api/local/*`, `/_redeven_direct/ws`, `/_redeven_proxy/*`, `/cs/*`, and `/pf/*`. Password mode protects non-public routes, direct sessions are minted as short-lived Flowersec connect artifacts, and runtime responses include the normalized Runtime Service snapshot.

Local UI bind parsing accepts `localhost`, canonical loopback IP literals, concrete non-loopback unicast IPv4 and IPv6 literals, and the `0.0.0.0` and `::` wildcards. It never resolves DNS names. Network exposure requires a fixed port; dynamic port `0` remains available only for explicit loopback IP binds. A network bind is valid only when password authentication and the command-line plaintext exposure acknowledgement are both present. Wildcard startup enumerates active, non-loopback, same-family unicast interface addresses, excludes unspecified, multicast, link-local, zoned, and IPv4-mapped IPv6 addresses, sorts them deterministically, and fails when no real access address remains.

Runtime starts two independent HTTP listener boundaries. The public Local UI listener records only exact canonical authorities for the actual bound or enumerated access IPs and ports, and every request passes that authority gate before route, cookie, WebSocket, or access-gate processing. A separate trusted listener binds `127.0.0.1:0`, mounts `HandlerForDesktopBridge()`, and is published as the required `RuntimeAttachEndpoint.local_ui_bridge_url`. It accepts canonical loopback authorities for native Desktop and placement-bridge traffic without weakening the public listener's exact-port authority rule. The private `0600` Desktop launch/status report carries this machine-only endpoint, but public startup events, health, access status, catalogs, display URLs, preferences, and renderer projections do not expose it. Runtime health returns the public `local_ui_url` and ordered `local_ui_urls` so a native Desktop health probe can travel through the trusted listener while refreshing user-facing addresses independently. Desktop validates the bridge value as an HTTP loopback-IP root with an explicit port and no credentials, query, or fragment. DNS names, fake localhost suffixes, alternate IPv4 notation, malformed ports, zones, mapped IPv6, non-loopback authorities, and unlisted public authorities are rejected.

The network server bounds request headers, request bodies, header-read time, read time, write time, idle time, and WebSocket frames. Responses receive CSP frame ancestry, content-type sniffing, referrer, permissions, and same-origin frame headers. Browser WebSocket upgrades require an exact same-scheme, same-authority Origin for the validated request authority. Runtime-control keeps its target identity, bearer token, and loopback peer checks; its non-browser WebSocket may omit Origin, but any supplied Origin must still match its loopback authority.

For a plaintext public request whose validated authority uses `localhost`, Local UI derives the direct candidate and upstream address together from the actual loopback IP listener in the request context, requiring the same configured port and an exact member of the listener authority allowlist. This keeps the user-facing `localhost` URL while satisfying Flowersec's IP-literal plaintext contract without choosing an IPv4-only fallback. IP-literal requests and TLS `wss://localhost` requests retain their validated request authority.

Before returning a direct connect artifact, Local UI commits one SQLite transaction containing the encrypted `AuthorizationRecord`, immutable handler and access-session binding, artifact and projection digests, the actual validated request origin for launcher/runtime/app, the exact environment target binding, and an HMAC-protected browser spend receipt. The browser uses Floe Webapp's required `commitSpend` callback to commit that receipt through the same-origin spend endpoint before Flowersec sends credential-bearing network traffic. Raw artifacts, plaintext authorization records, receipts, and plugin credentials are not stored in the spend table.

Local UI opens and exactly verifies the versioned store before it creates the Acceptor or starts a listener. Each process start atomically advances `boot_generation`, revokes older pending rows, burns older reservations, releases older leases, and revokes their unspent browser receipts; failure prevents startup. Authorization generates an independent random durable lease, performs an exact `pending -> reserved` CAS, decrypts and parses the row-bound record, calls Flowersec authorization, and commits `reserved -> leased` before allowing the session. Handler resolution reads the immutable binding from that same row. Parse, authorization, or leased-commit failures only burn the authority; Acceptor release is exact-lease scoped, while logout, access expiry, and shutdown may revoke an explicit access-session owner. In-process maps retain only active-session cleanup projections and never authorize a request.

# Boundaries

Local UI route behavior is part of the runtime trust boundary. Public Env App shell GET/HEAD requests may pass before local unlock so the shell can load, but local APIs, direct sessions, codespaces, and port-forward routes stay access-gated when password mode is enabled. Browser WebSocket same-origin admission treats `http://localhost:<port>` as equivalent to the exact IP-literal Host only when that Host is the request's actual configured loopback listener authority on the same port. Missing listener identity, another port, another origin, TLS, network exposure, and trusted Desktop bridge requests do not enter this alias path. Network exposure is plaintext HTTP: password authentication controls access but does not protect passwords, cookies, page resources, or non-Flowersec HTTP traffic from interception or modification. Flowersec protects its encrypted session payload only after the E2EE handshake completes. The trusted listener is reachable only through local loopback and `redeven desktop-bridge`; native Desktop, SSH, and container paths must not replace it with or fall back to the public listener. Runtime-control, Desktop model-source, and runtime management sockets remain loopback or local-socket protected regardless of Local UI exposure. The authority keyring is permission-restricted and separate from SQLite; missing keys, schema drift, future schema versions, and database errors fail closed without plaintext fallback or state reset.

# Evidence

- `redeven:internal/localui/localui.go:50` - Local UI options require bind, agent, app server, state, runtime-control, version, diagnostics, and access gate inputs.
- `redeven:internal/localui/bind.go:32` - Bind parsing distinguishes loopback, concrete network IP, and wildcard exposure while enforcing fixed network ports.
- `redeven:internal/localui/http_security.go:24` - Listener and interface addresses produce the exact public network authority allowlist and real display URLs.
- `redeven:internal/runtimemanagement/status.go:57` - Runtime attach status requires the machine-only `local_ui_bridge_url` field.
- `redeven:internal/localui/localui.go:417` - Runtime starts the trusted Local UI bridge listener on an ephemeral IPv4 loopback port.
- `redeven:internal/localui/localui.go:1390` - Direct endpoint construction selects one verified authority for both the artifact candidate and upstream address.
- `redeven:internal/localui/authorization_store.go:138` - Store startup loads the separate keyring, migrates and verifies SQLite, and advances the boot generation.
- `redeven:internal/localui/authorization_store.go:284` - Issuance atomically persists encrypted authorization authority and its bound browser spend row.
- `redeven:internal/localui/authorization_store.go:353` - Authorization uses exact reservation, row-bound decryption, parsing, and burned failure convergence.
- `redeven:internal/localui/localui.go:368` - The Acceptor authorizes and resolves handlers through the durable store and releases exact leases.
- `redeven:internal/envapp/ui_src/src/ui/services/controlplaneApi.ts:501` - Local acquisition uses Floe Webapp with the actual page origin, durable spend commit, and exact target validation.
- `redeven:internal/localui/localui_e2e_test.go:27` - A real plaintext localhost listener mints an IP-literal artifact, completes the Flowersec handshake, and serves monitor and filesystem RPCs.
- `redeven:internal/localui/localui.go:607` - Runtime health carries only the public Local UI URL projection alongside Runtime state.
- `redeven:cmd/redeven/desktop_launch_report.go:123` - The private Desktop launch/status report validates and carries the trusted bridge endpoint.
- `redeven:desktop/src/main/desktopSessionTransport.ts:1` - Native Desktop transport requires the trusted bridge and never selects a public interface address.
