---
type: AI Runtime Contract
title: AI tool approval and interaction runtime
description: Floret v7 pending interactions, effect authorization, and Flower row-local outcomes.
tags: [ai, tools, approvals, flower]
timestamp: 2026-08-14T00:00:00Z
---
# Summary

Pending approval and user input are typed Floret thread interactions. Redeven authorizes the product request and maps safe presentation; it does not persist or recover a second approval lifecycle. Resolve commits the canonical interaction-result batch before updating and publishing the current view. Floret v7.1.4 publishes the unresolved interaction and its matching active projection in one transition: waiting interactions clear `run_progress`, while other active summaries retain it. Redeven therefore never receives an active summary with an invalid combination. Persistence failure returns an error and leaves the live interaction unresolved. Rejection and cancellation are row-local outcomes, never global message failures.

# Contract

Each interaction has one stable identity and belongs to one thread and tool call or input request. Respond validates all required answers and keeps secret values out of browser persistence and logs. Approval acceptance obtains an exact one-shot effect authorization before irreversible execution. Rejection resolves only the matching interaction, records a quiet declined tool result, and allows provider continuation without producing `MESSAGE FAILED` or a Flower-wide error card.

Effect attempts have stable identities. Canonical effect intent is written before an irreversible operation. A known result is canonical and deduplicated. If an outcome cannot be confirmed, Floret closes every unfinished operation in that Turn and writes one `effect_outcome_unknown` terminal failure. Flower shows the failure and allows a new reply, but cannot replay the original effect.

Cancel atomically clears unresolved interactions, closes unfinished tool work, and writes one terminal aborted turn before returning. An unknown started effect instead converges to the distinct failed terminal state. Late provider, tool, and save-point work cannot reactivate either terminal Turn. Resolve and Cancel races converge through the single thread runtime owner. Redeven handlers return the typed terminal current view without waiting for provider continuation, receipt observation, authority release, or a legacy local handler.

# Boundaries

Floret owns canonical interaction identity, atomic answer settlement, effect-attempt state, cancellation, and unknown-outcome termination. Redeven owns endpoint authorization, current product permission revalidation, safe DTO mapping, and the concrete effect handler. Browser interaction state is presentation only and cannot authorize, settle, or replay an effect.

# Evidence

- `redeven:go.mod` - Pins the released Floret v7.1.4 typed runtime.
- `redeven:internal/session/floret_v7_dependency_contract_test.go` - Enforces published-v7 adoption without local replacement.
- `redeven:internal/ai/approval_command.go` - Product approval authorization and typed mapping.
- `redeven:internal/ai/floret_effect_authorization.go` - Revalidates product policy and transfers an invocation-bound proof exactly once.
- `redeven:internal/ai/floret_approval_command_integration_test.go` - Exercises canonical approval and provider-correction behavior through the published runtime.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Row-local interaction controls and nonblocking composer.
