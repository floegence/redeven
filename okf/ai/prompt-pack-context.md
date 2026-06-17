---
type: AI Context Contract
title: Prompt pack user context
description: Ask Flower context actions become first-class prompt-pack user context before provider message construction.
tags: [ai, flower, context, prompt-pack]
timestamp: 2026-06-17T00:00:00Z
---

Redeven treats user-selected Ask Flower context as a first-class model input. The runtime does not rely on transcript JSON, lifecycle events, or the raw user prompt text to make launcher context visible to the model.

# Mechanism

Clients send a standard `assistant.ask.flower` context action with the turn input. The AI service validates the action against the Flower context-action contract, normalizes it, and converts it into `context/model.UserProvidedContext` before building the prompt pack. The prompt pack keeps the user context separate from objective, dialogue, execution evidence, long-term memory, and attachments. The packer budgets the section as `user_context`, records token usage, and preserves it through compaction clones. Provider message construction renders the section as a separate user message titled `User-provided context:` before recent dialogue and before the current user prompt.

# Boundaries

User-provided context is not a permission grant, not a working-directory mutation, and not long-term memory. `suggested_working_dir_abs` is model-visible context only; runtime authority still comes from session metadata and existing thread/runtime execution policy. Persisted transcript `contextAction` remains an observable record, but it is not the model-context source of truth. Direct API callers, queued turns, and persisted user messages must use the same strict Flower context-action validator; malformed or non-Flower actions fail instead of being dropped into a context-free turn.

# Citations

[1] redeven:internal/ai/context_action.go:126 - Runtime validates and normalizes standard Ask Flower context actions.
[2] redeven:internal/ai/context/model/types.go:89 - `UserProvidedContext` and its item shape live in the prompt-pack model layer.
[3] redeven:internal/ai/context/model/types.go:150 - `PromptPack` carries `UserProvidedContext` as a first-class field.
[4] redeven:internal/ai/context/packer/builder.go:24 - Prompt-pack build input accepts user-provided context.
[5] redeven:internal/ai/context/packer/builder.go:113 - The packer copies user-provided context into the prompt pack.
[6] redeven:internal/ai/context/packer/builder.go:148 - Prompt-pack budgets include a dedicated `user_context` section.
[7] redeven:internal/ai/service.go:1504 - Run preparation converts the effective input context action before building the prompt pack.
[8] redeven:internal/ai/native_runtime.go:2141 - Provider messages render user-provided context before recent dialogue and current input.
