---
type: Runtime Contract
title: Runtime transport dependencies
description: Runtime transport uses Flowersec sessions while terminal lifecycle is delegated to Floeterm managers.
tags: [architecture, dependencies, terminal]
timestamp: 2026-10-07T00:00:00Z
quality_exception: Published Flowersec transport and Floeterm boundary covering session ownership, protocol profiles, and shared admission.
---
# Summary

Redeven runtime builds control and data sessions on the Transport v3 artifact and the current Flowersec lease, connection-controller, session, RPC, and byte-stream primitives, while terminal lifecycle is delegated to Floeterm. Each Env App owns one protocol provider and current Flowersec session; RPC and independent live streams share it. Placement HTTP/2 is a separate SSH stdio boundary and does not change Flowersec wire or public SDK contracts.

# Contract

## AI Flower RPC registration

The local direct and remote agent production session profiles register the
complete AI inventory before Flowersec freezes a session. The closed request
set is send user turn, list messages, stop thread, and submit user-input
response; the AI event type is explicitly a server notification. A declared
method therefore cannot fail at the router with a missing-handler 404. Each
request acquires the current AI service generation and returns structured 503
when unavailable while the session remains usable. Workspace live timeline is
observed through the current session HTTP stream under the
[Env App session event transport](env-event-transport.md) contract.
Stop remains one RPC lifecycle command without a fallback transport.

## Mechanism

The released runtime dependency set includes Floeterm terminal-go v0.19.2 and Flowersec Go v5.10.3. Flowersec v5.10.3 places standalone WebSocket sessions behind a close-before-wait shutdown barrier: shutdown stops admission, closes active sessions, and waits for lease release before the Runtime process may exit. Redeven relies on that published lifecycle instead of duplicating it.

The [Runtime binary build contract](runtime-binary-portability.md) owns native
Floeterm linkage, portable Linux artifacts, compiler preflight and source/relink
distribution. Every shipped Runtime retains the published native terminal engine.

Redeven pins released `flowersec-go` and `terminal-go` versions in `go.mod`. The Runtime consumes Flowersec Go v5.10.3; Env App and Desktop consume Flowersec TypeScript v5.10.3 through published packages only. The agent delegates retry and connection lifecycle to Flowersec's controllers, structured diagnostics, wait, and connect APIs. It does not run a parallel retry loop or reuse a spent artifact. Public Local UI composes pages and `/flowersec/v3/direct` on one configured port. Explicit HTTP uses the published `flowersec-http-direct/1` profile; HTTPS retains normal `flowersec/3`, exact-SAN certificates, and client trust. Desktop-private Local UI uses the separate `flowersec-private-loopback/1` profile restricted to same-origin numeric-loopback `ws:` after bridge-token admission. Neither explicit profile changes normal Transport v3 TLS defaults. [Local UI network exposure](../security/local-ui-network-exposure.md) owns the product protocol-selection contract.

[Product RPC request encoding](product-rpc-request-encoding.md) owns JSON construction at the Redeven codec boundary.

Each Env App product tree mounts exactly one `ProtocolProvider`. Its `ConnectionController` is the only owner allowed to replace the current Flowersec session. RPC, terminals, file reads, and other real-time capabilities reuse that session and open separate `ByteStream` instances; terminal traffic remains only `terminal/live_v1`. Switching a Flower thread, Activity or Workbench mode, terminal view, or file consumer cannot reconnect Flowersec. When the session terminates, old streams are not replayed, and no capability may introduce polling, HTTP, RPC, or a second session as fallback. Redeven does not extend Flowersec's Go, TypeScript, Rust, or Swift public Stream APIs.

The published Floe acquisition lifecycle owns established browser-session health: a 20-second Flowersec liveness probe with a 10-second deadline, plus foreground, online, and page restoration checks. Failed health closes only the observed session so its existing Flowersec controller can reacquire. Probes coalesce and are canceled on replacement or disposal. Env App lifecycle events only nudge a waiting controller through `retryNow`; they never rebuild terminal connections or reset server retry delays. The browser consumes Floe v0.64.0, whose `disconnect()` resolves after controller cancellation and pending acquisition settle. The recovery surface retains the mounted workspace behind an inert boundary, reports offline state explicitly, and keeps technical steps collapsed. Recoverable interruptions return to the retained workspace automatically; terminal authorization or identity failures require an explicit action.

The recovery surface distinguishes active connection work, a scheduled wait, a user-stopped recovery, and a terminal failure. An idle controller outside an explicit connection replacement has no retry owner and must never appear to be reconnecting. Countdown timestamps come from Flowersec's `nextRetryAtUnixMilliseconds` or the Desktop bridge snapshot, never a copied backoff formula. A server `retry_after` minimum disables immediate retry until it expires. Local artifact acquisition normalizes Redeven business error codes and preserves HTTP failure status and `Retry-After` for the published source to classify. Stop cancels the controller and any active Desktop recovery, fences obsolete access callbacks, and retains the inert workspace. Resume waits for cancellation before explicitly creating a fresh connection. Browser wake cannot resume a user-stopped recovery; no product retry timer exists.

SSH and container placement use standard HTTP/2 over one private `desktop-bridge` stdio exec outside Flowersec. It multiplexes only `local-ui`, `runtime-control`, and `gateway-protocol` CONNECT streams and relies on SSH for transport authentication and encryption. It creates no Flowersec candidate, artifact, lease, admission path, or E2EE exception. Explicit public HTTP and private-loopback profiles do not negotiate or downgrade ordinary TLS transports.

Remote data sessions are Flowersec endpoint clients. Redeven constructs the complete business `RPCHandlers` before `Connect`, passes them through `ConnectorOptions`, and registers application streams and `ProxyServer` on Flowersec v5.10.3's role-neutral `StreamHandlers`; the connected session starts exactly one published stream dispatcher. Inbound terminal RPC handlers are registered in that pre-connect plan without a placeholder outbound peer. Only after `Connect` returns does Redeven attach the real session `RPCPeer`, which immediately replays current terminal metadata. `StreamHandlers.Serve` performs its internal session close before returning; Redeven then detaches the peer, invokes the outer idempotent close, and cleans up the plan. Redeven does not use accepted-server `SessionHandlers` for this client role, proxy outbound notifications through a second peer owner, or copy an `AcceptStream` loop. The control-plane `grant_server` message is a notification with exact bounded decoding and an issuer-provided future artifact expiry; it has no request/response fallback.

Remote artifact issuance, digest-global spending, control-pool replay, and relink recovery are specified in [Runtime artifact spend and control pool](runtime-artifact-spend-and-control-pool.md). The transport session binds the Lease to that contract before any opaque artifact is spent.
Flowersec proxy requests use the validated browser source and origin context; payload-provided external origins are ignored, and opaque origins do not become forwarded request metadata. The Go HTTP proxy returns the first 3xx response with its original `Location` instead of following redirects. Browser Service Worker streams use one outstanding `chunk_credit_v2` credit per pull; cancellation wakes waiting consumers. The optional Yamux stream write queue budget defaults to 4 MiB and is released after each write so an exhausted stream can recover. Reconnect paths share the active promise for the same configuration, including during backoff, preventing duplicate connection attempts without adding a global scheduler.

Code App and Port Forward sessions expose only Flowersec proxy handlers to product callers, but their server still registers an empty Flowersec RPC router because the released high-level connector creates and retains an `rpc` bootstrap stream for the connection lifetime. Unknown RPC types return the standard 404 response and do not close that bootstrap stream. These sessions do not register Redeven business RPC handlers, and they use the same private server constructor so the required transport lifecycle cannot drift between the two proxy products.

The control Direct session replaces record-level keepalive writes with acknowledged Yamux liveness probes at a 15-second interval and a 10-second timeout. Tunnel sessions keep Flowersec's idle-timeout-derived liveness policy. Runtime client, endpoint, and Local UI Direct server setup all select 64 KiB outbound encrypted-record chunks and explicit Yamux limits: 64 active streams, 32 inbound streams, 256 KiB frames and per-stream receive memory, 64 KiB preferred outbound frames, and 16 MiB session receive memory. Runtime RPC streams start request handlers only when work is available, run at most 32 handlers concurrently, and hold at most 128 pending requests in FIFO order; notification queues remain bounded at 128 entries. Desktop SSH streaming commands distinguish caller-requested termination from an unexpected remote exit: explicit termination waits for the command's complete close lifecycle and does not start a post-termination control health probe, while unexpected failures still verify the reusable control transport before classification. Redeven's runtime proxy product adapter blocks only CSP, CSP Report Only, and X-Frame-Options because those embedding policies conflict with proxied product surfaces; Flowersec continues forwarding the remaining default security headers. These are transport and product-policy controls; Redeven does not copy Flowersec framing, multiplexing, RPC scheduling, proxy filtering, or protocol implementation.


Terminal ownership, live framing, history, attachment arbitration, and warmup are specified in [Runtime terminal lifecycle](runtime-terminal-lifecycle.md); this concept only defines the Flowersec/Floeterm dependency boundary and shared transport admission.
# Boundaries

Compatibility depends on these published transport and terminal interfaces staying aligned. Redeven compatibility epoch 11 requires Desktop and Runtime v0.12.0 or newer and upgrades from epochs 9 and 10. Replacing or bypassing them can break placement multiplexing, liveness teardown, bounded RPC, TLS admission, terminal ownership, Presentation ordering, history generation, controller arbitration, or session lifecycle. History and session diagnostics are observability only; neither Redeven nor Floeterm uses session count to reject creation, close a PTY, or pause a running session.

# Evidence

- `redeven:go.mod:8` - Redeven pins floeterm terminal-go in the runtime module.
- `redeven:internal/agent/agent.go:20` - Agent imports the published Flowersec Go v5 root package and uses `ConnectionController`, `WaitForSession`, `Connect`, `Session`, `RPCPeer`, and `ByteStream`.
- `redeven:internal/envapp/ui_src/src/ui/App.tsx:217` - One Env App product tree owns one protocol provider.
- `redeven:internal/envapp/ui_src/src/ui/services/terminalTransport.ts:68` - Each terminal attachment opens `terminal/live_v1` on the current shared session.
- `redeven:internal/envapp/ui_src/src/ui/utils/fileStreamReader.ts:72` - File reads open independent streams on that same session.
- `redeven:internal/agent/agent.go:1149` - Remote data acquisition binds its Lease to the digest-global durable spend ledger before connection.
- `redeven:internal/sessionrpc/router.go:42` - One minimal RPC registrar binds the same business router to endpoint-client and accepted-server Flowersec facades.
- `redeven:internal/agent/control_artifact_source.go:35` - Control acquisition selects and burns a sequence-bound persisted pool entry.
- `redeven:internal/agent/control_artifact_pool.go:67` - Top-up and ACK replay use one persisted pending request and bounded response validation.
- `redeven:internal/config/bootstrap.go:215` - Bootstrap persists and reuses the delivery request and runtime identity attempt before exchange.
- `redeven:internal/agent/local_direct_test.go:56` - Local direct sessions prove authorized channel registration, terminal notification attachment and detachment, and admission rejection during shutdown.
- `redeven:internal/agent/agent.go:1339` - Remote and local production session assembly share AI registration and detach cleanup.
- `redeven:internal/ai/rpc_inventory.go:20` - Canonical closed AI request and notification inventory.
- `redeven:internal/agent/ai_rpc_registration_test.go:13` - Production registration and structured-unavailable coverage for every request method.
- `redeven:internal/terminal/manager.go:14` - Runtime terminal manager wraps floeterm terminal-go plus Flowersec RPC types.
- `redeven:scripts/build_runtime_binary.sh:1` - One target-aware native-CGO builder owns Desktop bundle and SSH source Runtime compilation.
- `redeven:internal/terminal/manager_test.go` - Tests cover authorized terminal metadata notification broadcast, snapshot mapping, normalization, and payload isolation.
- `redeven:internal/terminal/lifecycle.go:190` - Concurrent delete callers join one session-scoped in-flight cleanup operation.
- `redeven:AGENTS.md:173` - Repository rules require published upstream releases instead of local sibling checkouts.
- `redeven:internal/envapp/ui_src/src/ui/security/localTransportSecurity.ts:20` - Local direct startup admits either public HTTPS or exact `desktop_private_bridge_v2` numeric-loopback HTTP provenance, with no inferred fallback.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:1455` - Remote tunnel reconnects explicitly require TLS.
- `redeven:internal/localui/localui.go:1517` - Local UI Direct sessions configure outbound record chunking and Yamux limits.
- `redeven:internal/localui/network_server.go` - Redeven selects published same-port HTTP/WS or HTTPS/WSS composition.
- `redeven:internal/localui/device_ca.go` - Local UI startup validates the CA identity and creates an ephemeral exact-SAN leaf without claiming client-side trust.
- `redeven:internal/runtimeproxy/runtimeproxy.go:15` - Redeven declares the three embedding-policy response headers blocked by its product adapter.
- `redeven:internal/runtimeservice/compatibility_contract.json:2` - Local UI exposure requires compatibility epoch 11 and a matched v0.12.0 Desktop and Runtime pair.
- `redeven:internal/terminal/semantic_history_rpc_test.go` - Deterministic fixtures verify viewport requests, continuation chunks, direct targets, lane isolation, generation fencing, and RPC payload budgets.
- `redeven:internal/envapp/ui_src/scripts/terminalCarrierRunnerPolicy.node-test.mjs:1` - Carrier policy fixes automatic headless ownership, explicit diagnostics, and display-server independence.
- `redeven:scripts/check_renderer_e2e.sh:1` - The exact-main renderer gate runs the 64 KiB and 448 KiB process carrier classes.

- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalSessionRuntime.semantic.browser.test.tsx` - Direct semantic canvas, input, history, theme, resize, link, and performance coverage.
- `redeven:internal/envapp/ui_src/scripts/checkSemanticTerminalCarrier.mjs` - Real Runtime, PTY, Activity, Workbench, clear, top resize, refresh, and multi-view carrier.
