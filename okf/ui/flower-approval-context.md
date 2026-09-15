---
type: UI Contract
title: Flower interactions and context state
description: Typed pending interactions, automatic context compression, and unlocked composer behavior.
tags: [ui, flower, approval, input, context]
timestamp: 2026-09-15T00:00:00Z
---
# Summary

Approval and waiting-user prompts are projections of Floret typed pending interactions. The bottom action mode is one mutually exclusive surface with fixed priority `input_request` then `approval` then `chat`, while the ordinary thread rail always remains interactive; decision surfaces never make a shared ancestor inert or install a pointer-blocking overlay.

# Contract

## Answering questions

Ask User keeps explicit choice-versus-custom draft identity per question. Published Floret rich choices preserve source identity and descriptions; choice submission uses the existing value, not the source identifier. The runtime response mode and optional placeholder are mapped directly. String-only tool and historical input remains supported without invented metadata. The decision surface keeps the ordinary composer width, placement, and Floe material. Only a mounted text editor declares the composite input boundary; pure choices and approvals retain published button and radio focus. A quiet waiting label precedes a distinct short header and the complete question. Without a separate header, the full question leads. Duplicate summaries and filler guidance are omitted. Fixed answers use flat rows with published Floe radio indicators, a 40-pixel desktop minimum without descriptions and a 56-pixel minimum with descriptions, 4-pixel row gaps, 12 pixels between question and choices, and 16-pixel outer padding. Touch targets are at least 44 pixels; a separate capsule action selects a custom answer and reveals the existing text editor without losing its draft. Keyboard navigation includes both fixed and custom answers. Choice controls load on demand with a local placeholder; the question, draft owner, and navigation remain mounted, and focus handoff waits for the controls while respecting subsequent user focus changes. Continue is a 36-pixel-high capsule, matching the ordinary circular Send and Stop controls. Secret answers use a password field and are sent directly to Respond; they are excluded from ComposerDraft persistence, IndexedDB outbox, diagnostics, and timeline text. A successful response applies the returned current view immediately. Duplicate response requests resolve idempotently and never append duplicate user content.

An accepted input interaction becomes one structured user response receipt. It preserves Floret's original question order, shows each question with its public answer, omits settled choices, and shows only a localized hidden-answer marker for secret questions. Historical reads and live CurrentView updates map to the same `input-response` block; message text and copy output derive from that block rather than from an answer-only fallback. Missing presentation, duplicate question identity, unknown answers, missing public answers, and inconsistent redaction fail the projection explicitly. Unaccepted or cancelled input does not create a user receipt.

## Approving actions

Approval actions share one compact action row for batch rejection, rejection, one-time approval, and Stop. Each decision is an independent Floe Button capsule with its own visible keyboard focus; Stop stays circular. The single approval leads with a quiet waiting label and the safe action label as its title; a distinct description, actual targets, complete scrollable command, and evidenced risk follow only when present. Its content forms one group, with a separator before the footer. Batch approvals retain their group heading and individual decisions. Ancillary action details use a native disclosure. A single-action footer states the one-time approval scope. Localized action labels wrap as a group at narrow widths without clipping focus or displacing actions outside the surface. After an input response advances to approval, focus prefers the first enabled decision and falls back to Stop only when no decision is available.

Every pending, requested primary approval remains visible even when its action reports `can_approve=false`, the adapter cannot mutate, the selected thread is read-only, or detail is pending; those states disable every decision action and present the canonical unavailable or read-only reason instead of falling back to chat. Accept or Reject calls the typed interaction boundary and applies its current view. A resolved approval interaction never creates a standalone timeline row: its lifecycle state merges only into the canonical tool item with the same `tool_call_id`, and an unmatched resolved interaction renders no tool shell. Rejection is a quiet tool-row outcome. Batch rejection resolves only the listed pending interactions.

The approval surface does not mount the ordinary textarea, password input, attachment or reference lane, working-directory, permission, model, reasoning, context-usage, or composer-footer controls. Per-thread text, attachment, and reference drafts remain owned by `ComposerDraftStore` while unmounted and return unchanged when the last approval resolves back to chat. Stop remains available directly in the approval action row instead of depending on the ordinary composer footer. No local handoff, consumed-interaction set, approval generation, or command busy reducer controls canonical visibility.

Approval copy prefers the canonical safe label, then a distinct description, before a localized operation fallback. A label identical to the command is not repeated as a title. File and network targets remain visible, and internal tool identifiers never become titles. Generic write effects do not prove file mutation: only a known file mutation with its declared write effect uses the file warning. Command names never determine risk; computer write actions do not claim to write files. Internal tool names and target-encoding prefixes are never user-facing.

## Context and recovery

Runtime restart recovery is quiet unless content cannot be recovered, in which case the affected row offers a nonblocking retry. Context usage, automatic compression, and the pure `/compact` mapping are owned by [AI model and context runtime](../ai/model-context-runtime.md), not by the approval surface.

# Boundaries

The decision surface owns drafts, disabled reasons, focus, and row-local commands only. It cannot authorize from rendered state, persist secret answers, settle an interaction locally, create a lifecycle row, or block navigation. Floret's typed current view remains the canonical interaction and tool outcome authority.

# Evidence

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Input, approval, composer, and navigation behavior.
- `redeven:internal/flower_ui/src/inputResponse.ts` - Strict settled-input response contract and live projection.
- `redeven:internal/flower_ui/src/runtimeCurrentView.ts` - Canonical interaction and tool-row projection.
- `redeven:internal/flower_ui/src/composer/createFlowerComposerDraftCoordinator.ts` - Per-thread choice/custom draft state.
- `redeven:internal/flower_ui/src/transportOutbox.ts` - Ordinary input persistence boundary.
- `redeven:internal/flower_ui/src/chat/FlowerContextCompactionDivider.tsx` - Canonical automatic compression presentation.

- `redeven:internal/ai/flower_decision_fixture_test.go` - Real provider-to-runtime presentation fixtures consumed by UI mapping and browser tests.
