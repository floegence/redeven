---
type: Desktop Contract
title: Desktop runtime bridge
description: Canonical navigation and security boundary for Desktop-integrated Runtime access and direct lifecycle.
tags: [desktop, runtime, bridge, lifecycle]
timestamp: 2026-08-27T00:00:00Z
---
# Summary

Redeven Desktop opens Runtime instances through machine-readable startup, scoped transport, session, and process contracts. Runtime remains independently runnable without Gateway. Redeven-managed lifecycle actions use the registered Local, WSL, SSH, or container direct channel and are owned by Desktop's process-local coordinator; Gateway and Provider remain access-only. This overview is the canonical navigation point for readiness, recovery, WSL/SSH operations, and model/session integration. Focused concepts own the independent details while this concept retains the boundary between Desktop lifecycle coordination, Runtime services, optional access forwarding, and plugin capabilities.

# Contract

## Mechanism

This concept is the stable overview for the subject. Detailed contracts are maintained in the focused concepts below:

- [Desktop runtime readiness](desktop-runtime-readiness.md)

- [Desktop transport recovery](desktop-transport-recovery.md)

- [Desktop SSH runtime operations](desktop-ssh-runtime-operations.md)

- [Desktop WSL runtime operations](desktop-wsl-runtime-operations.md)

- [Desktop session and model source](desktop-session-model-source.md)

Native Local Environment transport is independent from public Local UI addressing. Runtime writes the required `local_ui_bridge_url` and fresh 256-bit `local_ui_bridge_token` into its local socket status and private `0600` Desktop launch report. A Desktop-only Runtime may omit public `local_ui_url` and `local_ui_urls`; explicit external access continues to publish them as display addresses. WSL, SSH, and container bridge hello responses carry the same token over private stdio. Native BrowserWindow loading, health verification, access unlock, and Desktop Flower requests require the validated HTTP loopback-IP root plus that token and never fall back to a Tailscale, VPN, RFC1918, or other public interface address. Desktop health and Env App asset probes send the authorization header; Electron injects it only for HTTP requests and WebSocket upgrades using the exact private bridge host and port, after diagnostics have captured the token-free request.

Each WSL, SSH, or container Runtime placement owns one long-lived `desktop-bridge` exec and one HTTP/2 session over that exec's stdio. SSH and SSH-container placements additionally own one credential-scoped SSH transport lease. macOS/Linux reuse ControlMaster; Windows runs the Bridge in one native OpenSSH child, as defined by [SSH transport](desktop-ssh-runtime-operations.md). Node composes stdin and stdout into the HTTP/2 client connection; Go serves the peer with `http2.Server.ServeConn`. There is no TCP listener, TLS, HTTP/1, Upgrade, Redeven frame codec, stream-id allocator, or global read scheduler at this boundary. The session protocol is exactly `redeven-desktop-placement-h2/1`; older bridge protocols fail with an update requirement and are never negotiated or retried as a fallback.

`local-ui`, `runtime-control`, and `gateway-protocol` are independent HTTP/2 CONNECT streams. The internal `openStream(surface)` interface remains the only caller boundary. Hello and Runtime shutdown are bounded control requests on the same session. The connection allows at most 64 concurrent streams, a 256 KiB receive window per stream, a 16 MiB connection receive window, 32 MiB of Node session memory, and bounded header count and size. Fifteen seconds without inbound frames starts one PING; ten seconds without its acknowledgement closes the session. A stream reset or half-close affects only that stream. Stdio, exec, SSH, GOAWAY, or HTTP/2 termination is recovered once by the existing SSH placement owner with a fresh exec and session; individual streams do not reconnect or replay. A terminated WSL bridge stays offline until an explicit Open, Start, or Retry action creates a new bridge.

Managed readiness records store only Runtime PID, start identity, Runtime Service state, and placement. They never retain an executable path, bridge URL, token, runtime-control credential, or a URL from a bridge that has already closed. The standard managed executable is derived once from the live placement when Desktop opens the bridge. Open creates or reuses that one live placement bridge and derives the Env App base, entry, display, and allowed URL only from its live record. SSH target identity contains no URL. External URL, Provider, and Gateway paths continue to own and validate their explicit public URL and cannot borrow the managed private bridge path.

Successful Env App shell and entry-asset validation may be reused only inside the current Desktop process for the same registered target, process start identity, and Runtime Service build identity. Replacement loopback proxy ports do not invalidate that package fact, while a different target or changed process/build identity always validates again and failed validation is never cached. This cache does not reuse authorization: every replacement bridge performs a fresh authorized health request with its own live URL and token before shell validation can be reused.

`desktopSessionTransport` resolves the immutable transport kind, base URL, entry URL, display URL, navigation boundary, proxy policy, and partition before a session window exists. Native Local Environment, SSH/container placement, and Gateway loopback sessions use session-scoped non-persistent Electron partitions configured with `setProxy({ mode: 'direct' })` before the first load. Root, child, access-gate, and codespace windows share that partition, and session closure clears its storage. Provider remote and external Local UI sessions continue to use the default Session and system proxy policy.

WebRequest diagnostics are installed idempotently for every Electron Session that Desktop uses. An opening root document with final HTTP status 400 or greater fails immediately with transport kind, proxy policy, and status diagnostics; Chromium network failures remain immediate through `did-fail-load`. The readiness timeout remains only for a successfully loaded document that never reports an interactive access gate or connected Runtime state. Renderer projections, Welcome snapshots, persisted preferences, and user diagnostics omit both `local_ui_bridge_url` and `local_ui_bridge_token`; a Desktop-only Runtime has no public display URL to synthesize. The main process projects only `desktop_private_bridge_v2` through the session-context preload for private native and placement documents. Env App accepts numeric-loopback HTTP and the separate `flowersec-private-loopback/1` browser connector only with that exact provenance. Placement HTTP/2 remains outside Flowersec and cannot carry a Flowersec artifact or weaken its TLS, admission, lease, or E2EE rules. HTTPS and normal `flowersec/3` WSS remain mandatory for every ordinary browser, Provider, external Local UI, and public Runtime document.

# Boundaries

Runtime-control is a local Desktop coordination capability, not a general network API or plugin grant plane. Bridge, health, process, Gateway, Provider, and session observations must not become competing lifecycle authorities. Desktop must not log or project the bridge token, attach it to a public Flowersec WSS origin, change the system proxy, install a CA, modify the system trust store, install Tailscale/VPN/private-range bypass tables, globally disable proxying, or recover a missing authorized bridge by selecting a public Local UI address. The private Flowersec profile is accepted only by the explicit Desktop provenance path and cannot become a Provider, Gateway, URL, or public-browser fallback. ReDevPlugin, Provider, Runtime Control, public Local UI, and Gateway contracts retain their access and execution boundaries.

# Evidence

- `redeven:cmd/redeven/main.go:299` - Local Desktop startup is rejected for remote-only mode.
- `redeven:desktop/src/main/localUIURL.ts:44` - Desktop builds the Env App entry URL under `/_redeven_proxy/env/`.
- `redeven:cmd/redeven/desktop_launch_report.go:123` - Ready and attached private reports require and validate the trusted bridge URL.
- `redeven:internal/localui/localui.go:417` - Runtime starts a separate ephemeral loopback listener for trusted Desktop transport.
- `redeven:desktop/src/main/desktopSessionTransport.ts:1` - Desktop resolves transport, display, proxy, and partition state through one contract.
- `redeven:desktop/src/main/runtimeState.ts:1` - Private bridge probes keep live authorization separate from target-scoped shell integrity reuse.
- `redeven:desktop/src/main/runtimePlacementBridgeSession.ts:555` - One stdio-backed HTTP/2 session owns control requests, CONNECT streams, liveness, and recovery.
- `redeven:internal/desktopbridge/server.go:26` - Runtime serves the private HTTP/2 connection directly on bridge stdio.
- `redeven:desktop/src/main/main.ts:8222` - Session creation prepares direct Electron proxy state before loading Desktop-owned loopback transport.
- `redeven:desktop/src/main/main.ts:16928` - Per-Session diagnostics fail opening root documents on final HTTP errors.
- `redeven:okf/desktop/desktop-runtime-process-lifecycle.md:1` - Runtime process inventory and lifecycle ordering are maintained as a separate Desktop contract.
- `redeven:desktop/src/main/main.ts:8854` - Welcome Flower cold-starts Local Environment through structured local Runtime lifecycle progress.
