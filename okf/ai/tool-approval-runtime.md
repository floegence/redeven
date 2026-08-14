---
type: AI Runtime Contract
title: AI tool approval and interaction runtime
description: Floret v4 pending interactions, effect authorization, and Flower row-local outcomes.
tags: [ai, tools, approvals, flower]
timestamp: 2026-08-14T00:00:00Z
---
# Summary

Pending approval and user input are typed Floret thread interactions. Redeven authorizes the product request and maps safe presentation; it does not persist, project, hand off, or recover a second approval lifecycle. Resolve updates the in-memory current view immediately and appends the canonical interaction result. Rejection and cancellation are normal row-local outcomes, never global message failures.

# Contract

Each interaction has one stable identity and belongs to one thread and tool call or input request. Respond validates all required answers and keeps secret values out of browser persistence and logs. Approval acceptance obtains an exact one-shot effect authorization before irreversible execution. Rejection resolves only the matching interaction, records a quiet declined tool result, and allows provider continuation without producing `MESSAGE FAILED` or a Flower-wide error card.

Effect attempts have stable identities. Canonical effect intent is written before an irreversible operation. A known result is canonical and deduplicated. A crash with unknown outcome does not replay automatically; Flower keeps the original tool row and exposes RetryEffect with explicit risk acknowledgement. Normal provider retry may repeat dispatch, but stable canonical identities prevent duplicate visible output.

Cancel clears unresolved interactions and produces one terminal canceled turn. Resolve and Cancel races converge through the single thread runtime owner. Redeven handlers return the typed current view without waiting for provider continuation, receipt observation, authority release, or a legacy local handler.

# Evidence

- `floret:runtime/thread_runtime.go` - Typed Respond, Cancel, and RetryEffect commands.
- `floret:internal/agentharness/effect_authorization.go` - One-shot effect authorization.
- `redeven:internal/ai/approval_command.go` - Product approval authorization and typed mapping.
- `redeven:internal/ai/retry_thread_effect.go` - Unknown-effect retry boundary.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Row-local interaction controls and nonblocking composer.
