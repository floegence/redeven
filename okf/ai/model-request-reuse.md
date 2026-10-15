---
type: AI Runtime Contract
title: Model request reuse
description: Execute Engine-owned prompt-cache and continuation decisions without creating another history or retry owner.
tags: [ai, providers, cache, usage]
timestamp: 2026-10-15T00:00:00Z
---
# Summary

Floret owns effective reuse decisions and canonical state. Redeven executes them through one prepared request and one Responses consumer. In-memory connections can optimize transmission only after the next canonical state and complete input agree. Failures return to normal turn recovery; supplemental context cannot enable reuse.

# Contract

Runtime/Desktop epoch 61 and model-source RPC v2 preserve Floret's effective request reuse policy. The Engine decides prompt-cache enablement/namespace, native-state permission and continuation preference. Adapters cannot broaden it. Queue acceptance, replay and reads use one validated canonical base, preserving native history across queue-only mutations and restart without ancestor fallback or a new schema migration.

Official OpenAI requests derive a bounded, non-secret cache key from that namespace and provider/account routing identity. ChatGPT authentication on the official Responses route defaults to WebSocket; other authentication and custom endpoints retain HTTP. Runtime Service and Desktop executor each own a bounded process-local pool (16 connections, five-minute idle expiry, 55-minute rotation between requests). Connections isolate provider, endpoint, account, model and prompt scope. A socket processes one request at a time; its last successful response is usable only when the next canonical PreviousState, complete rendered input prefix, native output order and fixed settings match. Otherwise it sends full input from the same prepared request. Full input always owns estimates and fingerprints.

HTTP and WebSocket use one Responses event consumer. An unsupported upgrade before command dispatch permits one HTTP fallback; an explicit stale-response rejection before generation permits one full-input resend. Authentication, rate-limit and invalid-request errors retain their classifications. Uncertain delivery or partial-output disconnect closes the socket and uses ordinary canonical failure/retry. Stop, timeout, logout, Desktop RPC disconnect and shutdown abort connections. Supplemental context closes the scope's reusable connection, sends no application cache/continuation hints and retains no native state. No network retry layer, persistent transport history or alternate UI waiting state exists.

## Cache usage presentation

The existing context tooltip shows the latest completed request and cumulative session cache hit rates. Both use disjoint ordinary-input, cache-read and cache-write buckets with one formatter; absent valid input displays “—”, while measured zero hits display “0%”. Recent counters project Floret's canonical confirmed usage directly and clear with its existing model/compaction boundaries. They are not inferred from context-window occupancy or persisted in a host statistics store. OpenAI ordinary input subtracts both SDK cache-read and cache-write tokens from total input; invalid, negative or excessive cached counts fail explicitly using overflow-safe bounds. Historical cumulative usage is neither rewritten nor backfilled.

# Evidence

- `redeven:internal/ai/model_gateway_openai_connections.go` - Executor-owned pool, exact continuation checks and bounded transport fallback.
- `redeven:internal/ai/model_gateway_openai_connections_test.go` - Local WebSocket/SSE continuation, tool order, cancellation, isolation and executor shutdown tests.
- `redeven:internal/ai/model_gateway_usage.go` - Disjoint input buckets and explicit invalid-usage failures.
- `redeven:internal/ai/floret_events.go` - Shared canonical usage projection for live updates and refresh.
- `redeven:internal/flower_ui/src/chat/flowerContextPresentation.ts` - One rate calculation and formatter for recent and cumulative counters.
