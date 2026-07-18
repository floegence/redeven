---
type: Runtime Contract
title: Local UI surface
description: Local UI serves browser entrypoints, access-gated APIs, direct sessions, Env App proxying, codespaces, and port forwards.
tags: [architecture, local-ui, runtime, security]
timestamp: 2026-07-17T00:00:00Z
---
# Summary

Redeven Local UI is the browser-facing endpoint runtime surface. It exposes the Env App proxy, Local UI status APIs, direct Flowersec session handoff, Browser Editor codespace routes, and port-forward routes from the same runtime-managed HTTP server.

# Contract

## Mechanism

`localui.Server` is built with an agent, Code App app server, bind spec, runtime-control socket path, Local Environment identity, diagnostics store, and optional access gate. The handler mounts `/api/local/*`, `/_redeven_direct/ws`, `/_redeven_proxy/*`, `/cs/*`, and `/pf/*`. Password mode protects non-public routes, direct sessions are minted as short-lived Flowersec connect artifacts, and runtime responses include the normalized Runtime Service snapshot.

Local UI bind parsing accepts `localhost`, canonical loopback IP literals, concrete non-loopback unicast IPv4 and IPv6 literals, and the `0.0.0.0` and `::` wildcards. It never resolves DNS names. Network exposure requires a fixed port; dynamic port `0` remains available only for explicit loopback IP binds. A network bind is valid only when password authentication and the command-line plaintext exposure acknowledgement are both present. Wildcard startup enumerates active, non-loopback, same-family unicast interface addresses, excludes unspecified, multicast, link-local, zoned, and IPv4-mapped IPv6 addresses, sorts them deterministically, and fails when no real access address remains.

Runtime starts two independent HTTP listener boundaries. The public Local UI listener records only exact canonical authorities for the actual bound or enumerated access IPs and ports, and every request passes that authority gate before route, cookie, WebSocket, or access-gate processing. A separate trusted listener binds `127.0.0.1:0`, mounts `HandlerForDesktopBridge()`, and is published only as the required `RuntimeAttachEndpoint.local_ui_bridge_url`. It accepts canonical loopback authorities for placement-bridge traffic without weakening the public listener's exact-port authority rule. The trusted URL is not a display URL and is absent from startup presentation, health, access status, and user-facing surfaces. DNS names other than literal `localhost`, fake localhost suffixes, alternate IPv4 notation, userinfo, malformed ports, zones, mapped IPv6, non-loopback authorities, and unlisted public authorities are rejected.

The network server bounds request headers, request bodies, header-read time, read time, write time, idle time, and WebSocket frames. Responses receive CSP frame ancestry, content-type sniffing, referrer, permissions, and same-origin frame headers. Browser WebSocket upgrades require an exact same-scheme, same-authority Origin for the validated request authority. Runtime-control keeps its Desktop owner, bearer token, and loopback peer checks; its non-browser WebSocket may omit Origin, but any supplied Origin must still match its loopback authority.

Direct connect artifacts are one-time credentials, but resolution does not consume them. The Local UI resolver returns the E2EE PSK and an authenticated commit callback. Flowersec invokes that callback only after PSK authentication and before Yamux creation. The callback atomically removes the still-matching pending artifact, so a failed handshake does not exhaust a valid artifact and concurrent authenticated handshakes cannot both open sessions.

# Boundaries

Local UI route behavior is part of the runtime trust boundary. Public Env App shell GET/HEAD requests may pass before local unlock so the shell can load, but local APIs, direct sessions, codespaces, and port-forward routes stay access-gated when password mode is enabled. Network exposure is plaintext HTTP: password authentication controls access but does not protect passwords, cookies, page resources, or non-Flowersec HTTP traffic from interception or modification. Flowersec protects its encrypted session payload only after the E2EE handshake completes. The trusted listener is reachable only through local loopback and `redeven desktop-bridge`; SSH and container access must not expose or forward the public listener. Runtime-control, Desktop model-source, and runtime management sockets remain loopback or local-socket protected regardless of Local UI exposure.

# Evidence

- `redeven:internal/localui/localui.go:50` - Local UI options require bind, agent, app server, state, runtime-control, version, diagnostics, and access gate inputs.
- `redeven:internal/localui/bind.go:32` - Bind parsing distinguishes loopback, concrete network IP, and wildcard exposure while enforcing fixed network ports.
- `redeven:internal/localui/http_security.go:24` - Listener and interface addresses produce the exact public network authority allowlist and real display URLs.
- `redeven:internal/runtimemanagement/status.go:57` - Runtime attach status requires the machine-only `local_ui_bridge_url` field.
