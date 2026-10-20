---
type: AI Runtime Contract
title: Model request recovery
description: Recover frozen provider requests through one Engine budget and expose sanitized attempt progress without adding a product lifecycle.
tags: [ai, providers, recovery, diagnostics]
timestamp: 2026-10-20T00:00:00Z
---
# Summary

Floret owns retry admission, physical-request deadlines and attempt identity. Redeven supplies protocol facts through one adapter and displays the authoritative current view. Frozen input, confirmed tool exchanges and user cancellation retain their existing authority across transport recovery.

# Contract

Published Floret v7.58.0 shares provider.RetryAdviceForError across direct and Desktop paths. Wrapped ordinary EOF and unexpected EOF are interrupted streams only at the provider boundary. Adapters supply HTTP/stream/close-code facts; Engine owns bounded replay, cancellation, attempt identity and draft retirement. Explicit outer advice, even empty or Forbidden, stays authoritative. SDK retries remain disabled; all retransmission remains Engine-owned.

A recoverable WebSocket failure discards connection-local continuation and pins the thread route to full-input SSE for subsequent Engine attempts. Unsupported upgrade and pre-output stale continuation follow the same path. Completion ends reading before later EOF. See [request reuse](model-request-reuse.md) for routing and cleanup.

Diagnostics use transport_error for established transport failures and unknown when facts are absent. Empty means an actually read empty HTTP error body. Unknown failures use provider_request_failed, never a fabricated rejection. One envelope preserves actual provider identity, whitelisted protocol facts and private cause without nesting; prose classification exists only in historical read-only presentation. No provider, status or request ID is reconstructed from current settings or written back to old conversations.

Published Floret v7.42.0 owns one cancellable recovery budget for each frozen model request, including parent turns, SubAgent turns, compaction batches and titles. Defaults allow four extra sends (three for timeouts), jittered exponential delays and a five-minute recovery window. Server retry deadlines are captured at response receipt; long waits terminate without early redispatch. Authentication, exhausted quota, invalid contracts, unknown errors and tool effects remain terminal boundaries.

One upstream physical-request owner bounds connection establishment and stream
reading: five minutes to first semantic output, two minutes of output idle time,
five minutes during provider-hosted tool execution, and fifteen minutes total.
Zero configuration uses these defaults; negative limits fail startup before state
opens. Text, reasoning, argument fragments and valid tool-state transitions renew
progress. Heartbeats, empty deltas and usage do not. Returning from a hosted tool
restores the ordinary output limit. Local tools, approvals and user answers lie
outside a physical request. The same owner covers direct and prepared requests,
compaction and titles; Redeven only passes `ProviderRequestTimeoutPolicy`.

Timeout cancels only the physical attempt and enters the same frozen-request
recovery budget. Incomplete arguments never execute tools, confirmed tool results
remain checkpointed, and hosted tools without explicit replay safety prohibit
automatic retries. Exhaustion remains a typed Provider failure; user Stop remains
cancellation. Independent storage and unknown-effect errors retain priority.

Responses terminal events end reading immediately and enter one result-building
path; neither ordinary nor ChatGPT-native completion waits for EOF. Complete
items, final output fallback, native continuation checks, truncation and content
filtering retain their protocol semantics. Deferred cleanup closes the response
and releases the connection lease on success, failure or cancellation. HTTP,
WebSocket and Desktop transports propagate the upstream attempt context.

Redeven disables SDK retries, maps structured HTTP/SSE/WebSocket facts into `provider.RetryAdvice`, and preserves the original cause and sanitized diagnostics. A consumed prepared request can replay only its immutable rendered bytes; attachments and mutable tool lists are never resolved again. Each real send receives Floret's new AttemptID/Epoch and passes admission again. The failed attempt's known usage remains billable; missing usage stays unknown. Only explicitly read-only hosted search is marked replay safe.

Floret v7.73.0 carries typed non-semantic transport observations bound by the Engine to the physical attempt. Transport progress does not extend semantic deadlines, add content or usage, or authorize tools. One sanitized attempt collector owns logs, final failure diagnostics and transport observations. Unknown values stay absent; request bodies, tokens, headers and peer close prose never enter it. Historical failure envelopes remain readable without rewriting records.

Flower reads ThreadRunProgress.Transport and ThreadRunProgress.Retry from the authoritative current view. Main and companion surfaces display the absolute-deadline countdown and draft-replacement hint without admitting another turn. Stop stays available; manual retry appears only after terminal failure. It distinguishes a planned HTTPS switch from an active HTTPS attempt, hides the temporary hint after semantic output, and clears progress at terminal state. All shipped languages and main, narrow and SubAgent surfaces use the same current view. No product retry loop, timer queue, or durable retry ledger exists.

Published Floret v7.51.2 classifies the exact `basispoints_tool_arguments_stalled` code as a stream interruption, including HTTP 200 stream errors. Redeven consumes that category for live and historical failure presentation without duplicating the code list or restarting a terminal turn. The sanitized upstream message remains the primary displayed error; its machine code, transport status and request ID remain copyable diagnostics. Permanent errors and server retry prohibitions keep their existing priority.


# Boundaries

[Provider history](model-provider-surface-and-history.md) remains canonical. [Request reuse](model-request-reuse.md) owns in-memory transport selection and socket cleanup; [request measurement](model-request-measurement.md) owns protocol coverage evidence. Recovery never creates a product retry loop, durable transport ledger or automatic replay of uncertain tool effects.

# Evidence

- `redeven:internal/ai/floret_request_timeout_integration_test.go` - Heartbeat and incomplete-argument deadlines, typed failures, no dispatch, and released admission/HTTP resources.
- `redeven:internal/ai/model_gateway_terminal_deadline_test.go` - Terminal text, tools, truncation and content filtering release an open HTTP stream.
- `redeven:internal/ai/provider_failure.go` - Structured response-time retry advice and safe diagnostics.
- `redeven:internal/ai/floret_provider_prepared_test.go` - Single-use transports and frozen attachment replay.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.providerRetry.browser.test.tsx` - Countdown, draft replacement, reopen and Stop at desktop and narrow widths.
- `redeven:internal/ai/provider_attempt_diagnostic.go` - One sanitized diagnostic collector and non-semantic transport observations.
- `redeven:internal/ai/provider_transport_recovery_test.go` - Deterministic transport selection, cancellation, retry identity and lifecycle boundaries.
