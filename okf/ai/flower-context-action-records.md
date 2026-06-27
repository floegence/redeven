---
type: AI Context Contract
title: Flower context action records
description: Ask Flower context actions are validated product records and UI context badges, not a Redeven-owned provider history source.
tags: [ai, flower, context]
timestamp: 2026-06-17T00:00:00Z
---

Redeven treats user-selected Ask Flower context as a first-class product input record. The record is persisted with the user turn, used for Flower UI badges and product routing visibility, and kept out of Redeven-owned provider history construction. Floret owns provider-visible context lifecycle.

# Mechanism

Clients send a standard `assistant.ask.flower` context action with the turn input. The AI service validates the action against the Flower context-action contract and normalizes it before accepting the user turn. The accepted context action remains attached to the product transcript message and can be projected by Flower as a compact linked-context badge. Structured response records, secret answers, and upload bindings are persisted in the same turn-start flow so product UI and audit reads have one durable boundary.

Flower execution passes the current user input to Floret through the published `Host` facade. Redeven does not build provider-visible history, choose recent dialogue ranges, inject compacted summaries, or assemble provider-visible context from context actions. Floret combines the current input with its own journal, context lifecycle state, tools, permissions, and opaque provider continuation.

# Boundaries

User-provided context is not a permission grant, not a working-directory mutation, not long-term memory, and not a Redeven-controlled provider-history segment. `suggested_working_dir_abs` is product context only; runtime authority still comes from session metadata and existing thread/runtime execution policy. Execution context fields guide target selection, but they do not authorize direct Docker, SSH, systemd, launchctl, or process-manager operations. Persisted transcript `contextAction` remains an observable record, but it is not the model-context source of truth. Flower UI may project a compact linked-context badge from that record only when the persisted action still matches the standard Ask Flower schema and its target, source, locality, runtime hint, and session source values remain valid; malformed or non-Flower action records must not appear as legitimate linked context. Direct API callers, queued turns, and persisted user messages must use the same strict Flower context-action validator; malformed or non-Flower actions fail instead of being dropped into a context-free turn.

# Citations

[1] redeven:internal/ai/context_action.go:133 - Runtime validates and normalizes standard Ask Flower context actions.
[2] redeven:internal/ai/send_user_turn.go:257 - Turn start persists the prepared user transcript message at the durable acceptance boundary.
[3] redeven:internal/ai/send_user_turn.go:338 - Structured user input context is persisted as product state attached to the response message.
[4] redeven:internal/ai/floret_runtime.go:181 - Hosted Flower execution calls Floret with the current turn input instead of a preassembled history.
[5] redeven:internal/ai/floret_runtime.go:204 - Floret activity and usage results are projected back into Flower after the turn.
[6] redeven:internal/flower_ui/src/FlowerSurface.tsx:1384 - Flower UI renders linked-context transcript badges only for valid Ask Flower context actions.
