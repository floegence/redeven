---
type: AI Runtime Contract
title: Model request measurement
description: Map request-bound native measurement evidence while Floret owns compaction pressure and recovery.
tags: [ai, providers, context, compaction, usage]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Published Floret v7.70.0 owns one pressure calculation: a qualified native prefix plus an estimate of only the remaining frozen input, or the complete estimate when proof does not match. Redeven supplies protocol facts through optional public contracts.

# Contract

The 90% threshold and public output reservation semantics remain upstream.

Unknown gateways, hosted execution, automatic truncation and hidden continuation do not qualify.

Output refits and transport retries preserve the same frozen input; failed or cancelled attempts never supply committed response evidence.

# Boundaries

Floret alone checks attempt identity, commits output, persists and revalidates measurements, selects pressure and executes bounded [compaction and recovery](model-context-usage-and-compaction.md). [Request reuse](model-request-reuse.md) cannot broaden native coverage proof.

# Evidence

- redeven:internal/ai/model_gateway_measurement.go - Response and connection evidence, identity isolation and native replay boundaries.

- redeven:internal/ai/model_gateway_measurement_test.go - HTTP proof isolation, WebSocket lifetime changes, hidden execution rejection and explicit zero output.

- redeven:internal/ai/model_gateway_prepared.go - Frozen prefix/suffix mapping across output refits and replay.
