---
type: Runtime Contract
title: Local UI surface
description: Local UI serves browser entrypoints, access-gated APIs, direct sessions, Env App proxying, codespaces, and port forwards.
tags: [architecture, local-ui, runtime, security]
timestamp: 2026-06-17T00:00:00Z
---

Redeven Local UI is the browser-facing endpoint runtime surface. It exposes the Env App gateway, Local UI status APIs, direct Flowersec session handoff, Browser Editor codespace routes, and port-forward routes from the same runtime-managed HTTP server.

# Mechanism

`localui.Server` is built with an agent, Code App gateway, bind spec, runtime-control socket path, Local Environment identity, diagnostics store, and optional access gate. The handler mounts `/api/local/*`, `/_redeven_direct/ws`, `/_redeven_proxy/*`, `/cs/*`, and `/pf/*`. Password mode protects non-public routes, direct sessions are minted as short-lived Flowersec connect artifacts, and runtime responses include the normalized Runtime Service snapshot.

# Boundaries

Local UI route behavior is part of the runtime trust boundary. Public Env App shell GET/HEAD requests may pass before local unlock so the shell can load, but local APIs, direct sessions, codespaces, and port-forward routes stay access-gated when password mode is enabled.

# Citations

[1] redeven:internal/localui/localui.go:50 - Local UI options require bind, agent, gateway, state, runtime-control, version, diagnostics, and access gate inputs.
[2] redeven:internal/localui/localui.go:129 - The handler mounts root, codespace, port-forward, local API, direct WebSocket, and Env App proxy routes.
[3] redeven:internal/localui/localui.go:187 - Local UI computes a local permission cap from the runtime config path.
[4] redeven:internal/localui/localui.go:218 - Start opens all configured Local UI listeners and serves the handler.
[5] redeven:internal/localui/localui.go:656 - Local API calls return locked responses when local access is missing.
[6] redeven:internal/localui/localui.go:672 - Public Env App shell requests are limited to GET/HEAD under `/_redeven_proxy/env`.
[7] redeven:internal/localui/localui.go:683 - Gateway requests are access-gated except for the public Env App shell path.
[8] redeven:internal/localui/localui.go:1019 - `/api/local/runtime` returns direct WebSocket, Desktop flags, and Runtime Service data.
[9] redeven:internal/localui/localui.go:1089 - Direct sessions mint short-lived connect artifacts with channel id and E2EE PSK.
[10] redeven:internal/localui/localui.go:1151 - Connect artifact creation requires local access and an empty request body.
