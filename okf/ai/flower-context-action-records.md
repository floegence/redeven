---
type: AI Context Contract
title: Flower context action admission
description: Ask Flower context actions become Floret-owned message references and durable model-context snapshots at admission.
tags: [ai, flower, context]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

- Authority: Redeven owns a user-selected context action only before admission; Floret owns the admitted user message, ordered references, and Agent context lifecycle.
- Outcome: one validated context-action shape is queued with the command, then one admission mapper produces ordered durable `MessageReference` values and durable `UserInput.Context` snapshots.
- Invariants: Redeven does not persist the mapped references, runtime context, or a post-admission context-action copy.
- Failure boundary: malformed envelopes, unknown kinds, privacy-matrix violations, forged resource targets, damaged queued JSON, and projection failures stop the turn without dropping context.

# Contract

Clients send one `assistant.ask.flower` action with target, source, presentation, and typed context items. The runtime validates the source/kind privacy matrix: file surfaces use `file_path`, terminal uses `terminal_selection`, monitoring uses `process_snapshot`, and Git/environment producers use bounded `text_snapshot`. File/process records reject hidden text payloads; required identity, finite numeric values, Unicode counts, and capture metadata are validated.

Target fields on text, terminal, and process context are bounded durable routing hints. They identify what the user selected but do not grant permission, change tool routing, or prove remote execution authority. Only actions containing file or directory references bind server-derived canonical reference authority before admission. For those resource actions, the Desktop local-environment alias `local:local` is accepted in target and current-target fields and canonicalized to the current endpoint; unknown targets, mismatched source environments, and incompatible locality fail closed.

Before admission, the normalized action is stored only inside the unadmitted queued command. The canonical JSON writer preserves required zero values and rejects unknown kinds. Queue decode is strict; invalid JSON or an invalid item is an execution error, not a default empty action or unsupported-chip repair path. Once Floret admits the exact `TurnID`, Redeven removes the queued prompt/action record with the rest of the command.

Redeven consumes published Floret v7.8.0. Before `Send`, one mapper creates
ordered references and durable `MessageContextItem` snapshots. Reference text is
rendered once by Floret; host metadata supplies additional source and routing
facts. File and directory `ResourceRef` values remain opaque inside Floret and
never reach model text or browser DTOs. Upload attachments remain separate.

Each user message admits a runtime snapshot identifying the actual tool host,
working directory, current facts, and available skills. A changed snapshot applies
from that message onward. Environment cards separately identify the user-selected
device and include the existing `redeven-environment` skill at admission, so
routing does not depend on the model deciding to load it. Follow-ups, tool loops,
Ask User responses, retry, fork, restart, and compaction use Floret's one canonical
projection. `SupplementalContext` remains reserved for explicit temporary inputs,
including secrets; missing old temporary context is never reconstructed.

Floret schema v9 to v10 preserves historical journal bytes and request records.
Projection v8 restores already saved reference content and establishes an explicit
prefix boundary. The retired product queue importer retains its frozen migration
interpretation for idempotence; it is not a live context admission path.

Floret validates the message text, attachments, references, durable context, and explicitly temporary inputs before returning the typed current view. During the version 4 to 5 product migration, canonical acceptance allows the old migration source to be dropped before the schema transaction commits. Redeven does not retain a current-schema queue row or emit or store `flower.context_action.received`, `flower.context_action.injected`, a mapped reference row, or a supplemental-context audit copy.

Canonical Floret turn pages return the ordered public reference fields. Redeven projects only `reference_id`, kind, label, bounded text, truncation, and availability into Flower; raw `ResourceRef` never reaches the browser. Flower renders admitted references from this canonical DTO, including reference-only user messages. Queued commands continue to render their pre-admission `context_action`. The two paths are not merged or used as fallbacks for each other.

# Boundaries

Context actions and references do not alter working directory, target permission, tool routing authority, or attachment ownership. A model that acts on environment routing metadata must use the Redeven product command boundary, which resolves and authorizes the target independently. Canonical reference target identity comes only from the current `ToolTargetPolicy`; there is no persisted thread-routing fallback or dynamic policy callback. Redeven must not persist context actions as a second transcript message, replay supplemental context into later turns, repair damaged queued shapes, derive model context from Flower display state, or resolve a resource from browser-supplied path data. Resource activation re-reads the exact public Turn through `ReadThreadTurn`, selects the ordered reference by identity, and resolves its opaque host locator under current product authorization. Only `ErrTurnNotFound` maps to absence; other Floret errors remain unavailable and never trigger a history scan or product-state fallback.

# Evidence

- `redeven:internal/ai/context_action.go:101` - Canonical JSON encoding preserves the typed queued context fields.
- `redeven:internal/ai/context_action.go:185` - Normalization rejects damaged or unsupported context-action shapes before admission.
- `redeven:internal/ai/pending_input_migration.go` - Migration-only queued context actions decode through the strict validator.
- `redeven:internal/ai/context_action_floret.go:43` - One mapper produces Floret message references and durable context snapshots.
- `redeven:internal/ai/canonical_reference_authority.go` - Resource-bearing actions alone receive server-derived target authority; canonical identities and the documented local alias are enforced before canonicalization.
- `redeven:internal/ai/context_action_floret.go` - References and durable context are prepared together before typed Floret `Send`.
- `redeven:internal/ai/send_user_turn.go` - The typed command carries canonical user input and durable runtime context.
- `redeven:internal/ai/floret_timeline_messages.go:261` - Canonical user messages are built from Floret input, attachments, and references.
- `redeven:internal/ai/floret_timeline_messages.go:306` - Public reference projection excludes opaque `ResourceRef` and file-system path data.
- `redeven:internal/flower_ui/src/flowerLiveMapper.ts:929` - Flower strictly maps ordered canonical references without accepting `ResourceRef`.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:6157` - Admitted canonical reference chips use only the canonical-reference action path.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:6293` - Queued commands retain the separate pre-admission context-action path.
- `redeven:internal/ai/canonical_reference_open.go:62` - Reference activation rereads the exact Floret thread/turn/reference and revalidates current routing, target policy, filesystem scope, and resource state.
- `redeven:internal/envapp/ui_src/src/ui/flower/linkedContextNavigation.ts:27` - Env App revalidates linked paths before host navigation.
