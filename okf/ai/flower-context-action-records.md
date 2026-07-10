---
type: AI Context Contract
title: Flower context action records
description: Ask Flower context actions are validated product records that become current-turn Floret supplemental context without becoming Redeven-owned provider history.
tags: [ai, flower, context]
timestamp: 2026-07-10T00:00:00Z
---

Redeven treats user-selected Ask Flower context as a first-class product input record. The record is persisted with the user turn, used for Flower UI badges and product routing visibility, and projected into Floret as current-turn supplemental context. It is not copied into Redeven-owned provider history, long-term memory, permission state, or runtime authority.

# Mechanism

Clients send a standard `assistant.ask.flower` context action with the turn input. The AI service validates the action against the Flower context-action contract and normalizes it before accepting the user turn. Validation includes a source/kind privacy matrix: file browser, file preview, and editor preview accept only `file_path`; terminal accepts only `terminal_selection`; monitoring accepts only `process_snapshot`; Git browser and Desktop Welcome environment cards accept only generated `text_snapshot`. File and process context items reject hidden text payload fields, and malformed or non-Flower action records fail instead of silently becoming context-free turns. The accepted context action remains attached to the product transcript message and can be projected by Flower as a compact linked-context badge. Structured response records, secret answers, and upload bindings are persisted in the same turn-start flow so product UI and audit reads have one durable boundary.

Flower execution passes the current user input to Floret through the published `Host` facade from `github.com/floegence/floret` v0.3.89 or newer. Immediately before `Host.RunTurn`, Redeven formats the normalized Ask Flower record and attachment list into Floret `SupplementalContext` items. Process snapshots include process metadata such as PID, name, username, CPU, memory, platform, and capture time. File context items are metadata-only and carry path, directory flag, root label, source surface, target, and suggested working directory. Short terminal selections may carry the selected text; long terminal selections become metadata-only length/truncation records. Git and environment snapshots may carry bounded product-generated summaries. Normal attachments become `attachment_metadata` items with non-dereferenceable labels such as name and MIME type; upload URLs and file contents are not copied into Floret input or supplemental context. Redeven emits `flower.context_action.injected` with aggregate fields only: schema/action/provider/source/target, supplemental item count, rendered character count, truncation state, attachment item count, and a context hash.

# Boundaries

User-provided context is not a permission grant, not a working-directory mutation, not long-term memory, and not a Redeven-controlled provider-history segment. Floret owns provider-visible history, compaction, opaque provider continuation, and durable context lifecycle; Redeven only supplies host-provided supplemental context for the current user turn. `suggested_working_dir_abs` is product context only; runtime authority still comes from session metadata and existing thread/runtime execution policy. Execution context fields guide target selection, but they do not authorize direct Docker, SSH, systemd, launchctl, or process-manager operations. Persisted transcript `contextAction` remains an observable record, but it is not reused as model context outside the turn being launched. Flower UI may project a compact linked-context badge from that record only when the persisted action still matches the standard Ask Flower schema and its target, source, locality, runtime hint, and session source values remain valid; malformed or non-Flower action records must not appear as legitimate linked context. Direct API callers, queued turns, and persisted user messages must use the same strict Flower context-action validator; malformed or non-Flower actions fail instead of being dropped into a context-free turn.

# Citations

[1] redeven:internal/ai/context_action.go:136 - Runtime validates and normalizes standard Ask Flower context actions.
[2] redeven:internal/ai/send_user_turn.go:257 - Turn start persists the prepared user transcript message at the durable acceptance boundary.
[3] redeven:internal/ai/send_user_turn.go:338 - Structured user input context is persisted as product state attached to the response message.
[4] redeven:internal/ai/context_action.go:185 - Runtime enforces the source/kind privacy matrix for Ask Flower context items.
[5] redeven:internal/ai/context_action_floret.go:27 - Redeven projects normalized Ask Flower context and attachments into Floret supplemental context items.
[6] redeven:internal/ai/context_action_floret.go:83 - Attachments are projected as metadata-only supplemental context items.
[7] redeven:internal/ai/context_action_floret.go:217 - The injected-context event payload records aggregate metadata without raw context text or upload URLs.
[8] redeven:internal/ai/floret_runtime.go:184 - Hosted Flower execution computes supplemental context immediately before calling Floret.
[9] redeven:internal/ai/floret_runtime.go:188 - Floret receives the user input and supplemental context through the published `RunTurn` request.
[10] redeven:internal/flower_ui/src/FlowerSurface.tsx:1384 - Flower UI renders linked-context transcript badges only for valid Ask Flower context actions.
