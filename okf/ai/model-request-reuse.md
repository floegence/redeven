---
type: AI Runtime Contract
title: Model request reuse
description: Execute Engine-owned prompt-cache and continuation decisions without creating another history or retry owner.
tags: [ai, providers, cache, usage]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-23"
---
# Summary

Floret owns effective reuse decisions and canonical state. Redeven executes them through one prepared request and one Responses consumer. In-memory connections can optimize transmission only after the next canonical state and complete input agree. Failures return to normal turn recovery; supplemental context cannot enable reuse.

# Contract

Runtime/Desktop epoch 68 and model-source RPC v4 preserve Floret's effective request reuse policy. Adapters cannot broaden it.

Full input always owns estimates and fingerprints.

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

- `redeven:internal/ai/model_gateway_openai_connections.go` - Separates request fingerprints from authenticated connection admission and credential rotation.

- `redeven:internal/config/ai.go` - One effective continuation policy for every adapter initialization path.

- `redeven:internal/ai/openai_continuation_test.go` - Wire requests preserve full history with continuation disabled.

- `redeven:internal/flower_ui/src/settings/FlowerProviderDialog.tsx` - Conditional opt-in control and draft lifecycle.
