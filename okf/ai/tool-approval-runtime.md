---
type: AI Runtime Contract
title: AI tool approval and interaction runtime
description: Floret v7 pending interactions, effect authorization, and Flower row-local outcomes.
tags: [ai, tools, approvals, flower]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Pending approval and user input are typed Floret thread interactions. Redeven authorizes the product request and maps safe presentation; it does not persist or recover a second approval lifecycle. Resolve commits the canonical interaction-result batch before updating and publishing the current view. Floret v7.26.0 publishes the unresolved interaction and its matching active projection in one transition: waiting interactions clear `run_progress`, while other active summaries retain it. Redeven therefore never receives an active summary with an invalid combination. Persistence failure returns an error and leaves the live interaction unresolved. Rejection and cancellation are row-local outcomes, never global message failures.

# Contract

Each interaction has one stable identity and belongs to one thread and tool call or input request.

Canonical effect intent is written before an irreversible operation.

Redeven handlers return the typed terminal current view without waiting for provider continuation, receipt observation, authority release, or a legacy local handler.

# Boundaries

Floret owns canonical interaction identity, atomic answer settlement, effect-attempt state, cancellation, and unknown-outcome termination. Browser interaction state is presentation only and cannot authorize, settle, or replay an effect.

# Evidence

- `redeven:go.mod` - Pins the released Floret v7.26.0 typed runtime.

- `redeven:internal/session/floret_v7_dependency_contract_test.go` - Enforces published-v7 adoption without local replacement.

- `redeven:internal/ai/approval_command.go` - Product approval authorization and typed mapping.
