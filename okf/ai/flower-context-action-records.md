---
type: AI Context Contract
title: Flower context action records
description: Ask Flower context actions are strict queued product input and current-turn Floret supplemental context, not Redeven transcript state.
tags: [ai, flower, context]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

- Authority: Redeven owns a user-selected context action only before admission and as product presentation metadata; Floret owns the admitted user message and context lifecycle.
- Outcome: one validated context-action shape is queued with the command and projected once as typed current-turn supplemental context.
- Invariants: context actions are not attachments, permission grants, transcript rows, provider history, or long-term memory.
- Failure boundary: malformed envelopes, unknown kinds, privacy-matrix violations, damaged queued JSON, and projection failures stop the turn without dropping context.

# Contract

Clients send one `assistant.ask.flower` action with target, source, presentation, and typed context items. The runtime validates the source/kind privacy matrix: file surfaces use `file_path`, terminal uses `terminal_selection`, monitoring uses `process_snapshot`, and Git/environment producers use bounded `text_snapshot`. File/process records reject hidden text payloads; required identity, finite numeric values, Unicode counts, and capture metadata are validated.

Before admission, the normalized action is stored only inside the unadmitted queued command. The canonical JSON writer preserves required zero values and rejects unknown kinds. Queue decode is strict; invalid JSON or an invalid item is an execution error, not a default empty action or unsupported-chip repair path. Once Floret admits the exact `TurnID`, Redeven removes the queued prompt/action record with the rest of the command.

Redeven consumes the published Floret v0.19.1 contract. Immediately before `RunTurn`, it formats the current action into typed `RunTurnRequest.SupplementalContext`. Every accepted item must produce one valid supplemental item. File context remains metadata-only, terminal selections follow bounded inline/metadata rules, process snapshots carry product metrics, and text snapshots carry bounded producer-generated summaries. Context-action projection is separate from structured Floret attachments, whose opaque `ResourceRef` values are resolved by the provider adapter.

Redeven emits `flower.context_action.injected` with aggregate identity, item count, rendered character count, truncation state, and a context hash. The event contains no file body, upload URL, terminal selection text, or provider-visible message copy.

Flower may render the canonical current-turn supplemental context returned through Floret projections as linked-context chips. Host navigation is capability-gated: Env App may open file/directory surfaces after a user click and normal filesystem authorization, while hosts without that capability render the record as noninteractive. Navigation never mutates the Agent journal or adds file content to model context.

# Boundaries

Context actions do not alter working directory, target permission, tool routing authority, or attachment ownership. Redeven must not persist them as a second transcript message, replay historical context into later turns, repair damaged queued shapes, or derive model context from Flower display state.

# Evidence

- `redeven:internal/ai/context_action.go:101` - Canonical encoding and validation preserve typed context fields.
- `redeven:internal/ai/queued_turns.go:191` - Queued context actions decode through the strict validator.
- `redeven:internal/ai/context_action_floret.go:27` - Redeven projects current-turn context into Floret supplemental items.
- `redeven:internal/ai/floret_runtime.go:184` - Supplemental context is computed immediately before turn admission.
- `redeven:internal/flower_ui/src/contextActionWire.ts:280` - Flower parses canonical context-action records for display and navigation.
- `redeven:internal/envapp/ui_src/src/ui/flower/linkedContextNavigation.ts:26` - Env App revalidates file paths before host navigation.
