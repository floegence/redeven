---
type: AI Context Contract
title: Flower context action admission
description: Ask Flower context actions become Floret-owned message references and durable model-context snapshots at admission.
tags: [ai, flower, context]
timestamp: 2026-10-11T00:00:00Z
---
# Summary

- Authority: Redeven owns a user-selected context action only before admission; Floret owns the admitted user message, ordered references, and Agent context lifecycle.
- Outcome: one admission mapper validates and authorizes the submitted context action, then produces ordered durable `MessageReference` values and durable `UserInput.Context` snapshots.
- Invariants: Redeven does not persist the mapped references, runtime context, or a post-admission context-action copy.
- Failure boundary: malformed envelopes, unknown kinds, privacy-matrix violations, forged resource targets, and projection failures reject admission; the launcher preserves editable draft text and references.

# Contract

Clients send one `assistant.ask.flower` action with target, source, presentation, and typed context items. The runtime validates the source/kind privacy matrix: file surfaces use `file_path`, terminal uses `terminal_selection`, monitoring uses `process_snapshot`, and Git/environment producers use bounded `text_snapshot`. File/process records reject hidden text payloads; required identity, finite numeric values, Unicode counts, and capture metadata are validated.

Target fields on text, terminal, and process context are bounded durable routing hints. They identify what the user selected but do not grant permission, change tool routing, or prove remote execution authority. Only actions containing file or directory references bind server-derived canonical reference authority before admission. For those resource actions, the Desktop local-environment alias `local:local` is accepted in target and current-target fields and canonicalized to the current endpoint; unknown targets, mismatched source environments, and incompatible locality fail closed.

The connected resource endpoint supplies execution hints: Local UI uses `/api/local/runtime` identity (`env_local`), while remote access uses the connected environment endpoint. Desktop Cloud binding identifies the selected device for display and navigation; it never overrides Local UI resource identity, including when a Cloud environment is accessed through its local host. The server derives resource authority from the authenticated endpoint and current `ToolTargetPolicy`. One projection entry validates, authorizes, and canonicalizes the action; locator construction consumes only that authority and cannot infer it from client fields. Missing server authority rejects resource admission even when client hints agree with each other.

The context-action envelope exists only before typed admission. Floret queues and persists the mapped canonical input, without a product queue row or a post-admission envelope. Required zero values remain intact. The retired product queue decoder is migration-only, preserves its released interpretation, and rejects damaged JSON without fabricating an empty action.

Redeven consumes published Floret v7.27.2. Before `Send`, one mapper creates
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

Canonical Floret turn pages return the ordered public reference fields. Redeven projects only `reference_id`, kind, label, bounded text, truncation, and availability into Flower; raw `ResourceRef` never reaches the browser. Flower renders admitted references from this canonical DTO, including reference-only user messages. Queued input renders the same admitted canonical references. Neither path reconstructs references from a product context-action copy.

# Boundaries

Context actions and references do not alter working directory, target permission, tool routing authority, or attachment ownership. A model that acts on environment routing metadata must use the Redeven product command boundary, which resolves and authorizes the target independently. Canonical reference target identity comes only from the authenticated endpoint and current `ToolTargetPolicy`; there is no persisted thread-routing fallback or dynamic policy callback. Redeven must not persist context actions as a second transcript message, replay supplemental context into later turns, repair damaged queued shapes, derive model context from Flower display state, or resolve a resource from browser-supplied path data. Resource activation reads the canonical current thread view, selects the exact turn and reference by identity, and resolves its opaque host locator under current product authorization. Missing thread or reference maps to absence; other Floret errors remain unavailable and never trigger a product-state fallback.

# Evidence

- `redeven:internal/ai/context_action.go:101` - Typed context encoding preserves required zero values.
- `redeven:internal/ai/context_action.go:185` - Normalization rejects damaged or unsupported context-action shapes before admission.
- `redeven:internal/ai/pending_input_migration.go` - Migration-only queued context actions decode through the strict validator.
- `redeven:internal/ai/context_action_floret.go` - One mapper validates, authorizes, and produces Floret message references and durable context snapshots.
- `redeven:internal/ai/canonical_reference_authority.go` - Resource-bearing actions alone receive server-derived target authority; canonical identities and the documented local alias are enforced before canonicalization.
- `redeven:internal/ai/send_user_turn.go` - The typed command carries canonical user input and durable runtime context.
- `redeven:internal/ai/floret_timeline_messages.go:261` - Canonical user messages are built from Floret input, attachments, and references.
- `redeven:internal/ai/floret_timeline_messages.go:306` - Public reference projection excludes opaque `ResourceRef` and file-system path data.
- `redeven:internal/flower_ui/src/flowerLiveMapper.ts:929` - Flower strictly maps ordered canonical references without accepting `ResourceRef`.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:6157` - Admitted canonical reference chips use only the canonical-reference action path.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Queued input renders canonical references from Floret.
- `redeven:internal/ai/canonical_reference_open.go:62` - Reference activation rereads the exact Floret thread/turn/reference and revalidates current routing, target policy, filesystem scope, and resource state.
- `redeven:internal/envapp/ui_src/src/ui/flower/linkedContextNavigation.ts:27` - Env App revalidates linked paths before host navigation.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Context execution hints use the connected runtime identity independently of Desktop Cloud display identity.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.desktopFloatingSurfaces.e2e.test.tsx` - JPG, file, and directory submission across Cloud-linked local, unbound local, and remote access.
- `redeven:internal/ai/flower_file_context_integration_test.go` - Endpoint-bound canonical references survive follow-up sends, exact replay, restart, and fork without leaking locators to browser DTOs.
