---
type: Runtime Contract
title: Runtime transport composition and Env App recovery
tags: [architecture, dependencies, terminal]
lifecycle: contract
reviewed_at: "2026-11-06"
---
# Summary

Published Flowersec owns acquisition, framing, retries and connection replacement; Redeven maps exact product authorization onto one current Env App session. Published Flowersec owns Transportv3 connection/session/RPC/streams; Floeterm owns terminal lifecycle.

# Contract

Pins: terminal-go v0.20.0 and Flowersec Go v5.12.0. Env App and Desktop consume Flowersec TypeScript v5.12.0. Each Env App shares one current protocol session; switching thread/Activity/Workbench/terminal/file cannot reconnect it. Register complete AI inventory in direct/remote profiles before session freeze; declared methods cannot become router404. Stop is one RPC lifecycle command,no fallback.

Published WebSocketHTTPServerOptions.ApplicationHandler composes Gateway HTTP/Runtime on one TLS endpoint; egress.HTTPSProxy supplies explicit Cloud routing. [Web Center](web-environment-center.md) uses published controller/pinned RuntimeTLS/in-process Connector without new wire/replay. Desktop SSH placementHTTP2 remains separate. [Terminal](runtime-terminal-lifecycle.md) owns framing/history/attachment/warmup.

Env App adapts published artifact sources to exact origin/environment across HTTPS,explicit HTTP,Cloud/private loopback,requiring matching Service Worker control. Reconnect uses discriminated source contract. Map Portal uppercase codes to Floe HTTP classifier; emit canonical Flowersec codes retaining terminal/retryable/Retry-After authority. Desktop generation/revision fences stale updates. One immutable diagnostic view,no business-request replay.

Redeven coordinates its SSH bridge owner with the published acquisition source: wait for Desktop readiness before requesting local credentials and bound the product fetch/body to 15 seconds. Flowersec remains the only protocol retry authority. Failed session HTTP rejects mutations immediately; a retained view never queues them for reconnect. Existing published `SessionError` codes supply terminal-disconnect classification without interpreting message text or changing upstream wire contracts.

# Boundaries

Upstream owns acquisition/retry/framing/connection replacement; product selects profile/maps authorization. No prose classifiers,fallback URLs,second controller,TLS/private provenance bypass or background session renewal. Published interfaces must stay aligned for multiplexing,liveness,bounded RPC,admission,terminal Presentation/history/controller ownership. Diagnostics/session counts never reject creation,close PTY or pause sessions. Desktop bridge observations are not a second transport.

# Evidence

## Transport composition
- `redeven:go.mod:10` - Source.
- `redeven:internal/agent/agent.go:20` - Published Flowersec v5 controller, sessions, RPC and byte streams.

## Env App recovery

Flower HTTP, including attachment uploads, uses the bound session fetch on ordinary Env pages and custom turn routes. Uploads display indeterminate progress until confirmed completion; they retain stable idempotency identity, byte limits and cancellation. Published Flowersec `ProxyRequestInit.sessionBound` and host-only Go `ProxyServerOptions.SessionBoundRequests` remove elapsed/header/SSE-idle deadlines for the Env proxy. They preserve stream/body limits, admission caps, explicit cancellation and authoritative session termination. Generic port/app proxies retain finite defaults. No request metadata grants the server policy. Desktop local HTTP and live writes follow request ownership; cancellation interrupts a blocked write. The published Floe SSE parser preserves the per-request flag. Shared Shell model configuration, directory and readiness use the same session; their owners cancel on invalidation/pause/disposal. No scope or wire extension is required.

Run `REDEVEN_FLOWER_SESSION_ACCEPTANCE=1 go test ./internal/runtimeproxy -run '^TestFlowerSessionBoundBrowserE2E$' -count=1 -v -timeout=6m` for explicit carrier acceptance. The real published Go/browser tunnel and product session binding must retain one socket and one command through 130 seconds of delayed headers/body and SSE silence, then release cancelled/terminated requests and reject oversized bodies.

[Real encrypted-tunnel acceptance](../../internal/runtimeproxy/flower_session_browser_test.go) combines the published Go server, browser client, Floe parser and product session binding with 55-second header stalls, 75-second response stalls, stalled SSE, cancellation and byte-limit checks. It requires one connection and one command admission. [Floret runtime](../ai/floret-thread-runtime.md) owns historical repair.
