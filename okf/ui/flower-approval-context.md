---
type: UI Contract
title: Flower interactions and context state
description: Typed pending interactions, automatic context compression, and unlocked composer behavior.
tags: [ui, flower, approval, input, context]
timestamp: 2026-09-25T00:00:00Z
---
# Summary

Approval and waiting-user prompts are projections of Floret typed pending interactions. The bottom action mode is one mutually exclusive surface with fixed priority `input_request` then `approval` then `chat`, while the ordinary thread rail always remains interactive; decision surfaces never make a shared ancestor inert or install a pointer-blocking overlay.

# Contract

## Answering questions

Ask User keeps explicit choice-versus-custom draft identity per question. Published Floret rich choices preserve source identity and descriptions; choice submission uses the existing value, not the source identifier. The runtime response mode and optional placeholder are mapped directly. String-only tool and historical input remains supported without invented metadata. The decision surface keeps the ordinary composer width, placement, and Floe material. Only a mounted text editor declares the composite input boundary; pure choices and approvals retain published button and radio focus. A quiet waiting label precedes a distinct short header and the complete question. Without a separate header, the full question leads. Duplicate summaries and filler guidance are omitted. Fixed answers use flat rows with published Floe radio indicators, a 40-pixel desktop minimum without descriptions and a 56-pixel minimum with descriptions, 4-pixel row gaps, 12 pixels between question and choices, and 16-pixel outer padding. Touch targets are at least 44 pixels; a separate capsule action selects a custom answer and reveals the existing text editor without losing its draft. Keyboard navigation includes both fixed and custom answers. Choice controls load on demand with a local placeholder; the question, draft owner, and navigation remain mounted, and focus handoff waits for the controls while respecting subsequent user focus changes. Continue is a 36-pixel-high capsule, matching the ordinary circular Send and Stop controls. Secret answers use a password field and remain only in the volatile draft coordinator until canonical resolution or cancellation. They are sent directly to Respond and excluded from durable draft storage, IndexedDB outbox, diagnostics, and timeline text. A successful response applies the returned current view immediately. Duplicate response requests resolve idempotently and never append duplicate user content.

Current questions come exclusively from `CurrentView.interactions`. The legacy `waiting_prompt` DTO is a read-only compatibility projection and cannot create actionable UI. At the mapping boundary, exactly one unresolved input is allowed; question and option identities must be unique and complete, and choices must match the explicit answer mode. String options normalize there to explicit display identities and submitted values. A stale or unknown choice is invalid, never an answer-value fallback. Invalid current data enters the existing detail recovery surface. Missing write placeholders use short localized guidance, never the full question.

Ask User and approvals share a volatile submission guard keyed by thread and interaction. Read-only state, incomplete or failed detail, identity, and answer validity gate decisions; Stop and navigation remain available. Failure preserves the current draft without snapshot rollback. Accepted current views reconcile only the matching interaction's answers, including background threads and secrets. Late HTTP results pass the existing view-version check and cannot clear a later question or ordinary text. This guard never determines whether an interaction exists.

An accepted input interaction becomes one structured user response receipt. It preserves Floret's original question order, shows each question with its public answer, omits settled choices, and shows only a localized hidden-answer marker for secret questions. Historical reads and live CurrentView updates map to the same `input-response` block; message text and copy output derive from that block rather than from an answer-only fallback. Missing presentation, duplicate question identity, unknown answers, missing public answers, and inconsistent redaction fail the projection explicitly. Unaccepted or cancelled input does not create a user receipt.

## Approving actions

The [Flower approval surface](flower-approval-surface.md) owns the approval list, bounded layout, disclosure, focus, exact batch membership, and presentation contract. It shares the interaction submission guard and canonical reconciliation boundary described above.

## Context and recovery

Runtime restart recovery is quiet unless content cannot be recovered, in which case the affected row offers a nonblocking retry. Context usage, automatic compression, and the pure `/compact` mapping are owned by [AI model and context runtime](../ai/model-context-runtime.md), not by the approval surface. The composer circle prioritizes model-confirmed usage, separately labels current estimates, and preserves current-pressure warnings. All shipped locales provide the same distinction; keyboard users can focus the circle and dismiss its details with Escape.

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

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.inputSubmission.browser.test.tsx` - Duplicate submission, late replies, draft preservation, and background secret cleanup.
