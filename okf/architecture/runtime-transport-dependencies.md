---
type: Runtime Contract
title: Runtime transport composition and Env App recovery
tags: [architecture, dependencies, terminal]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Published Flowersec owns acquisition, framing, retries and connection replacement; Redeven maps exact product authorization onto one current Env App session. Views and consumers share that session without reconnecting or replaying business requests, while epochs fence obsolete Desktop observations.

# Contract

Published Flowersec owns Transportv3 connection/session/RPC/streams; Floeterm owns terminal lifecycle. Pins:Go/TSFlowersec5.11.1,terminal-go0.20.0. Each Env App shares one current protocol session; switching thread/Activity/Workbench/terminal/file cannot reconnect it. Register complete AI inventory in direct/remote profiles before session freeze; declared methods cannot become router404. Stop is one RPC lifecycle command,no fallback.

Published WebSocketHTTPServerOptions.ApplicationHandler composes Gateway HTTP/Runtime on one TLS endpoint; egress.HTTPSProxy supplies explicit Cloud routing. [Web Center](web-environment-center.md) uses published controller/pinned RuntimeTLS/in-process Connector without new wire/replay. Desktop SSH placementHTTP2 remains separate. [Terminal](runtime-terminal-lifecycle.md) owns framing/history/attachment/warmup.

Env App adapts published artifact sources to exact origin/environment across HTTPS,explicit HTTP,Cloud/private loopback,requiring matching Service Worker control. Reconnect uses discriminated source contract. Map Portal uppercase codes to Floe HTTP classifier; emit canonical Flowersec codes retaining terminal/retryable/Retry-After authority. Desktop generation/revision fences stale updates. One immutable diagnostic view,no business-request replay.

# Boundaries

Upstream owns acquisition/retry/framing/connection replacement; product selects profile/maps authorization. No prose classifiers,fallback URLs,second controller,TLS/private provenance bypass or background session renewal. Published interfaces must stay aligned for multiplexing,liveness,bounded RPC,admission,terminal Presentation/history/controller ownership. Diagnostics/session counts never reject creation,close PTY or pause sessions. Desktop bridge observations are not a second transport.

# Evidence

## Transport composition
- `redeven:go.mod:10` - Source.
- `redeven:internal/agent/agent.go:20` - Published Flowersec v5 controller, sessions, RPC and byte streams.

## Env App recovery
- `redeven:internal/envapp/ui_src/src/ui/services/controlplaneApi.ts:501` - Source.
- `redeven:internal/envapp/ui_src/src/ui/reconnect/createRuntimeReconnectController.ts:429` - Source.
