---
type: AI Interaction Contract
title: Flower context compaction and Goal continuation
tags: [ai, flower, goals, context, compaction, recovery]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Published Floret v7.74.0 owns compaction admission, installation, Goal continuation,
Stop, Retry and restart. Redeven authorizes and transmits the frozen intent and
presents canonical state. Pure compaction ends after installation or noop; Goal
continuation prepares context and continues work through the existing Engine and
current Goal review in the same execution.

# Contract

## Explicit manual intent
`POST /_redeven_proxy/api/ai/threads/{id}/context/compact` accepts `storage_generation`, `client_request_id` and optional `continue_goal`. True selects `goal_continuation` only when Floret finds an active canonical Goal during admission.

Failure and noop retain their actionable error or result.

# Boundaries

Floret exclusively owns canonical compaction and Goal execution. [Usage and presentation](model-context-usage-and-compaction.md) maps upstream facts; [qualification](../operations/flower-compaction-qualification.md) defines isolated runtime and provider checks.

# Evidence

- `redeven:internal/ai/compact_thread_context.go` - Authorized asynchronous admission through published Floret.

- `redeven:internal/ai/compact_thread_context_test.go` - Canvas Send rejection, preparation, replay, Goal intent and authorization.
