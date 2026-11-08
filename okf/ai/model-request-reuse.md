---
type: AI Runtime Contract
title: Model request reuse
tags: [ai, providers, cache, usage]
lifecycle: contract
reviewed_at: "2026-11-05"
---
# Summary

Floret owns reuse decisions/canonical state; Redeven runs one prepared request/Responses consumer. Failure follows ordinary turn recovery; supplemental context never enables reuse. Runtime/Desktop epoch 68 and model-source RPC v4 preserve Floret's effective request reuse policy.

# Contract

Adapters cannot broaden it.

Full input always owns estimates and fingerprints.

Official OpenAI Responses and Chat Completions requests use a deterministic,
URL-safe prompt cache key bounded to 64 ASCII characters. Redeven derives it
from Floret's namespace and the provider, normalized endpoint and account
identity without sending those values in plaintext. Disabled reuse and
non-official endpoints do not receive this key. A key-format change creates a
new provider cache namespace; it does not change canonical conversation state.

## Responses continuation configuration
`config.AIProvider.EffectiveResponsesContinuation` is the sole provider-level decision. Complete canonical input remains available when the ID is omitted.

No gateway-specific retry or alternative history owner is introduced.

## Cache usage presentation
The existing context tooltip shows the latest completed request and cumulative session cache hit rates. Recent counters project Floret's canonical confirmed usage directly and clear with its existing model/compaction boundaries. Historical cumulative usage is neither rewritten nor backfilled.

# Boundaries

HTTP and WebSocket use one Responses event consumer and send at most one generation per attempt. Unsupported upgrade, recoverable connection failure, interrupted streams, missing completion and precise pre-output stale continuation return to the Engine's existing budget and backoff.

There is no persistent transport history or second retry owner.

OpenAI request settings, continuation state, and input prefixes use SHA-256 only
as equality fingerprints for in-memory reuse decisions. These digests do not
store or verify user passwords and grant no authentication authority. Credential
rotation separately invalidates the live connection before another request.

# Evidence

- `redeven:internal/ai/model_gateway_openai_connections.go` - Source.
- `redeven:internal/ai/model_gateway_openai_cache_integration_test.go` - Floret thread acceptance.
