---
type: AI Interaction Contract
title: Flower context compaction and Goal continuation
tags: [ai, flower, goals, context, compaction, recovery]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Floret v7.74.0 owns compaction, Goal continuation, Stop/Retry/restart. Redeven transmits frozen authorized intent and renders canonical state. Pure compaction ends after install/noop; Goal continuation prepares context then uses existing Engine/current review in the same execution.

# Contract

## Explicit manual intent
`POST /_redeven_proxy/api/ai/threads/{id}/context/compact` accepts `storage_generation`, `client_request_id` and optional `continue_goal`. True selects `goal_continuation` only when Floret finds an active canonical Goal during admission.

Failure and noop retain their actionable error or result.

# Boundaries

Floret exclusively owns canonical compaction and Goal execution. [Usage and presentation](model-context-usage-and-compaction.md) maps upstream facts; [qualification](../operations/flower-compaction-qualification.md) defines isolated runtime and provider checks.

# Evidence

- `redeven:internal/ai/compact_thread_context.go` - Source.
- `redeven:internal/ai/compact_thread_context_test.go` - Tests.
