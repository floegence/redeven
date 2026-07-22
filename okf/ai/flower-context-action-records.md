---
type: AI Context Contract
title: Flower context action admission
description: Ask Flower context actions become Floret-owned message references and current-turn supplemental context at admission.
tags: [ai, flower, context]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

- Authority: Redeven owns a user-selected context action only before admission; Floret owns the admitted user message, ordered references, and Agent context lifecycle.
- Outcome: one validated context-action shape is queued with the command, then one admission mapper produces ordered durable `MessageReference` values and current-turn `SupplementalContext` values.
- Invariants: Redeven does not persist the mapped references, supplemental context, or a post-admission context-action copy.
- Failure boundary: malformed envelopes, unknown kinds, privacy-matrix violations, damaged queued JSON, and projection failures stop the turn without dropping context.

# Contract

Clients send one `assistant.ask.flower` action with target, source, presentation, and typed context items. The runtime validates the source/kind privacy matrix: file surfaces use `file_path`, terminal uses `terminal_selection`, monitoring uses `process_snapshot`, and Git/environment producers use bounded `text_snapshot`. File/process records reject hidden text payloads; required identity, finite numeric values, Unicode counts, and capture metadata are validated.

Before admission, the normalized action is stored only inside the unadmitted queued command. The canonical JSON writer preserves required zero values and rejects unknown kinds. Queue decode is strict; invalid JSON or an invalid item is an execution error, not a default empty action or unsupported-chip repair path. Once Floret admits the exact `TurnID`, Redeven removes the queued prompt/action record with the rest of the command.

Redeven consumes the published Floret v0.23.0 contract. Immediately before `RunTurn`, one pure mapper converts every accepted item into both an ordered Floret `MessageReference` for `TurnInput.References` and a typed `TurnSupplementalContextItem` for `RunTurnRequest.SupplementalContext`. Text, terminal, and process references contain bounded user-visible text. File and directory references contain a self-contained opaque host `ResourceRef`; it is durable only inside Floret and is not copied into Redeven storage. Supplemental items remain visible only to the current model turn. Structured upload attachments continue through `TurnInput.Attachments` and are independent from references.

Floret validates and atomically admits the message text, attachments, references, and turn-only supplemental context. After admission, Redeven removes the queued command and does not emit or store `flower.context_action.received`, `flower.context_action.injected`, a mapped reference row, or a supplemental-context audit copy.

Canonical Floret turn pages return the ordered public reference fields. Redeven projects only `reference_id`, kind, label, bounded text, truncation, and availability into Flower; raw `ResourceRef` never reaches the browser. Flower renders admitted references from this canonical DTO, including reference-only user messages. Queued commands continue to render their pre-admission `context_action`. The two paths are not merged or used as fallbacks for each other.

# Boundaries

Context actions and references do not alter working directory, target permission, tool routing authority, or attachment ownership. Redeven must not persist them as a second transcript message, replay supplemental context into later turns, repair damaged queued shapes, derive model context from Flower display state, or resolve a resource from browser-supplied path data. Any future resource-open action must re-read the exact public reference from Floret and resolve its opaque host locator under the current product authorization.

# Evidence

- `redeven:internal/ai/context_action.go:101` - Canonical JSON encoding preserves the typed queued context fields.
- `redeven:internal/ai/context_action.go:185` - Normalization rejects damaged or unsupported context-action shapes before admission.
- `redeven:internal/ai/queued_turns.go:262` - Queued context actions decode through the strict validator.
- `redeven:internal/ai/context_action_floret.go:43` - One mapper produces Floret message references and current-turn supplemental items.
- `redeven:internal/ai/floret_runtime.go:165` - References and supplemental context are prepared together before Floret admission.
- `redeven:internal/ai/floret_runtime.go:205` - The same admission request carries both canonical turn input and turn-only supplemental context.
- `redeven:internal/ai/floret_timeline_messages.go:261` - Canonical user messages are built from Floret input, attachments, and references.
- `redeven:internal/ai/floret_timeline_messages.go:306` - Public reference projection excludes opaque `ResourceRef` and file-system path data.
- `redeven:internal/flower_ui/src/flowerLiveMapper.ts:929` - Flower strictly maps ordered canonical references without accepting `ResourceRef`.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:6157` - Admitted canonical reference chips use only the canonical-reference action path.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:6293` - Queued commands retain the separate pre-admission context-action path.
- `redeven:internal/ai/canonical_reference_open.go:62` - Reference activation rereads the exact Floret thread/turn/reference and revalidates current routing, target policy, filesystem scope, and resource state.
- `redeven:internal/envapp/ui_src/src/ui/flower/linkedContextNavigation.ts:27` - Env App revalidates linked paths before host navigation.
