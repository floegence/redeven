---
type: Runtime Contract
title: Runtime transport dependencies
description: Runtime transport uses Flowersec sessions while terminal lifecycle is delegated to Floeterm managers.
tags: [architecture, dependencies, terminal]
timestamp: 2026-07-13T00:00:00Z
---

Redeven runtime builds control and data sessions on Flowersec client and endpoint primitives, while terminal lifecycle inside the runtime is delegated to Floeterm's terminal-go manager.

# Mechanism

The released runtime dependency set includes Floeterm terminal-go v0.4.24 and Flowersec Go v0.20.2.

Redeven pins released `flowersec-go` and `terminal-go` versions in `go.mod`. The runtime consumes Flowersec Go v0.20.2 and the browser surfaces consume Flowersec Core v0.20.2 through published packages only. The agent connects the remote control channel through `fsclient.ConnectDirect` and opens remote data sessions through `endpoint.ConnectTunnel`; both calls explicitly select Flowersec `RequireTLS`. Env App tunnel reconnects select the matching TypeScript policy, while Local UI direct reconnects explicitly select `AllowPlaintextForLoopback`. The Docker Local UI integration client makes the same loopback-only exception. Product code therefore does not depend on the library default and cannot silently accept remote `ws://` transport.

The control Direct session replaces record-level keepalive writes with acknowledged Yamux liveness probes at a 15-second interval and a 10-second timeout. Tunnel sessions keep Flowersec's idle-timeout-derived liveness policy. Runtime client, endpoint, and Local UI Direct server setup all select 64 KiB outbound encrypted-record chunks and explicit Yamux limits: 64 active streams, 32 inbound streams, 256 KiB frames and per-stream receive memory, 64 KiB preferred outbound frames, and 16 MiB session receive memory. Runtime RPC streams use 32 request workers with bounded request and notification queues of 128 entries each. Redeven's runtime proxy product adapter blocks only CSP, CSP Report Only, and X-Frame-Options because those embedding policies conflict with proxied product surfaces; Flowersec continues forwarding the remaining default security headers. These are transport and product-policy controls; Redeven does not copy Flowersec framing, multiplexing, RPC scheduling, proxy filtering, or protocol implementation.

The runtime wraps `termgo.NewManager` so terminal sessions, PTY activation, history accounting, and shell lifecycle setup stay inside Floeterm's manager abstraction. Redeven configures an 8 MiB history byte budget per session in addition to Floeterm's chunk bound, without configuring or enforcing a session-count limit. Redeven selects the shell and cache location, while released Floeterm providers generate Bash, Zsh, Fish, and POSIX initialization and OSC command lifecycle markers. Terminal attach registers the sink and calls Floeterm's atomic `AddConnectionWithHistoryBoundary` under one manager/session lock order; the response always carries the committed boundary, including zero, and each sink receives only later live source sequences. Env App assigns a monotonically increasing attachment generation scoped to the underlying protocol transport, so Activity and Workbench RPC facades share ordering across remounts and reconnect. Runtime rejects an older generation before capturing another boundary, retains the latest accepted attempt as the per-sink/session generation high-water, and lets a duplicate of the same generation and connection join the same activation result. All still-pending generations remain tracked until completion: entering the closing lifecycle completes that session's requests with not-found even if deletion later fails, sink or Manager shutdown completes them with connection-closed, and natural session close completes them with not-found. Completed failure results remain replayable until a newer generation is accepted. Attachment admission rechecks the Floeterm registry under the routing lock, and natural PTY exit atomically clears routing plus attach state so a stale Session pointer cannot recreate tombstones after close. Activation failure rolls routing back only when the same generation still owns the mapping. Connection removal stays inside the routing lock and occurs only when no remaining sink attachment owns that session/connection pair. Terminal sink writers use a separate stop signal instead of closing the producer queue, so broadcast and detach can overlap without a send-on-closed-channel panic. Terminal history RPC pages preserve Floeterm's explicit first-retained sequence, committed coverage, snapshot end, history generation, reset, and truncation metadata, including a valid zero coverage value; subsequent pages bind to the attach boundary, first snapshot end, and generation. Concurrent direct close, widget cleanup, and process-exit paths share one in-flight delete result per session. Closing sessions reject interaction immediately; successful cleanup removes routing and attach state, while a real cleanup failure restores an open, visible, retryable lifecycle with diagnostics and requires a newer attach generation.

# Boundaries

Compatibility depends on these transport and terminal interfaces staying aligned across released versions. Redeven compatibility epoch 6 requires Desktop and Runtime v0.8.1 or newer because the published v0.8.0 release still uses epoch 5 and cannot prove the terminal baseline when a Runtime omits explicit coverage metadata. Replacing or bypassing the published contracts can break control and data channel behavior, liveness teardown, bounded RPC dispatch, sparse history coverage, command lifecycle events, or terminal session lifecycle. ConnectArtifact v1, E2EE record framing, Yamux frames, and Redeven business RPC payloads remain owned by their existing upstream or product contracts; the v0.20 dependency update does not add Redeven business concepts to Flowersec. History and session diagnostics are observability signals only: neither Redeven nor Floeterm may use session count to reject creation, automatically close a PTY, or pause an existing session. Frontend renderer hibernation is not a runtime lifecycle transition: disposing an inactive `TerminalCore` must leave the terminal-go session and PTY running, and later snapshot or paged-history recovery resumes only the visual consumer.

# Citations

[1] redeven:go.mod:8 - Redeven pins floeterm terminal-go in the runtime module.
[2] redeven:go.mod:10 - Redeven pins flowersec-go in the runtime module.
[3] redeven:internal/agent/agent.go:20 - Agent imports Flowersec client, endpoint, proxy, and RPC packages.
[4] redeven:internal/agent/agent.go:532 - The control channel connects through fsclient.ConnectDirect.
[5] redeven:internal/agent/agent.go:1007 - Runtime data sessions connect through endpoint.ConnectTunnel.
[6] redeven:internal/terminal/manager.go:14 - Runtime terminal manager wraps floeterm terminal-go plus Flowersec RPC types.
[7] redeven:internal/terminal/manager.go:98 - Runtime configures the released terminal-go manager.
[8] redeven:internal/terminal/manager.go:104 - Each terminal session uses an 8 MiB history byte bound without a manager session limit.
[9] redeven:internal/terminal/manager.go:105 - Floeterm default providers own shell arguments, init files, and command lifecycle markers.
[10] redeven:internal/terminal/lifecycle.go:190 - Concurrent delete callers join one session-scoped in-flight cleanup operation.
[11] redeven:AGENTS.md:173 - Repository rules require published upstream releases instead of local sibling checkouts.
[12] redeven:go.mod:10 - Redeven consumes published flowersec-go v0.20.2.
[13] redeven:internal/agent/agent.go:547 - Remote direct control connections explicitly require TLS.
[14] redeven:internal/agent/agent.go:1018 - Remote tunnel sessions explicitly require TLS.
[15] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:1446 - Local direct reconnects explicitly allow plaintext only for loopback literals.
[16] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:1455 - Remote tunnel reconnects explicitly require TLS.
[17] redeven:internal/agent/agent.go:543 - Remote control connections configure acknowledged Yamux liveness.
[18] redeven:internal/agent/agent.go:1264 - Runtime RPC streams use explicit bounded server options.
[19] redeven:internal/localui/localui.go:1517 - Local UI Direct sessions configure outbound record chunking and Yamux limits.
[20] redeven:tests/docker_runtime_e2e/testclient/main.go:67 - Docker Local UI verification explicitly allows plaintext only for loopback.
[21] redeven:internal/runtimeproxy/runtimeproxy.go:15 - Redeven declares the three embedding-policy response headers blocked by its product adapter.
[22] redeven:internal/terminal/manager.go:1266 - Runtime history responses map Floeterm coverage snapshot fields without omitting zero values.
[23] redeven:internal/runtimeservice/compatibility_contract.json:30 - Terminal coverage requires compatibility epoch 6 and a matched v0.8.1 Desktop and Runtime pair.
[24] redeven:internal/terminal/manager.go:945 - Terminal attachment captures the committed Floeterm history boundary while holding the per-sink routing lock.
[25] redeven:internal/terminal/manager.go:743 - Live terminal notifications are filtered against each sink's atomic history boundary.
[26] redeven:internal/terminal/manager.go:587 - Latest accepted attach state rejects stale workers and preserves idempotent activation results before boundary capture.
[27] redeven:internal/terminal/manager.go:692 - Activation failure conditionally rolls routing and connection ownership back under one lock order.
[28] redeven:internal/terminal/lifecycle.go:327 - Natural terminal exit atomically clears routing and all pending attach generations.
[29] redeven:internal/terminal/manager.go:1361 - Sink writers use a stop signal instead of closing the producer queue.
