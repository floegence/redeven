---
type: AI Runtime Contract
title: Model request measurement
description: Map request-bound native measurement evidence while Floret owns compaction pressure and recovery.
tags: [ai, providers, context, compaction, usage]
timestamp: 2026-10-20T00:00:00Z
---
# Summary

Published Floret v7.70.0 owns one pressure calculation: a qualified native prefix plus an estimate of only the remaining frozen input, or the complete estimate when proof does not match. Redeven supplies protocol facts through optional public contracts.

# Contract

The 90% threshold and public output reservation semantics remain upstream. Schema 27 -> 28 is migrated only by Floret.

Redeven maps successful official Responses facts through optional PreparedRequestMeasurement and RequestMeasurement. Input scope remains provider_execution; protocol coverage evidence does not rename billing scope. HTTP uses this response's x-reasoning-included header, while WebSocket uses only the owning connection's handshake and unique lifetime identity. Unknown gateways, hosted execution, automatic truncation and hidden continuation do not qualify. Account, API credential and connection changes invalidate matching prefixes.

Encrypted reasoning has no ciphertext-to-token conversion. A complete ChatGPT native replay may establish a conservative input-plus-output boundary only when output usage is explicitly present and opaque replay inclusion is proven. Explicit output zero remains distinct from absent output usage.

Frozen suffix mapping reads no attachments, refreshes no context and performs no network counting. Output refits and transport retries preserve the same frozen input; failed or cancelled attempts never supply committed response evidence.

# Boundaries

Floret alone checks attempt identity, commits output, persists and revalidates measurements, selects pressure and executes bounded [compaction and recovery](model-context-usage-and-compaction.md). Redeven adds no pressure policy, lifecycle state or durable measurement copy. [Request reuse](model-request-reuse.md) cannot broaden native coverage proof.

# Evidence

- redeven:internal/ai/model_gateway_measurement.go - Response and connection evidence, identity isolation and native replay boundaries.
- redeven:internal/ai/model_gateway_measurement_test.go - HTTP proof isolation, WebSocket lifetime changes, hidden execution rejection and explicit zero output.
- redeven:internal/ai/model_gateway_prepared.go - Frozen prefix/suffix mapping across output refits and replay.
- redeven:internal/ai/floret_provider.go - Actual attempt and terminal response identity forwarding.
