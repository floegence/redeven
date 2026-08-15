---
type: UI Contract
title: Flower interactions and context state
description: Typed pending interactions, automatic context compression, and unlocked composer behavior.
tags: [ui, flower, approval, input, context]
timestamp: 2026-08-14T00:00:00Z
---
# Summary

Approval and waiting-user prompts are projections of Floret typed pending interactions. The bottom action mode is one mutually exclusive surface with fixed priority `input_request` then `approval` then `chat`, while the ordinary thread rail always remains interactive; decision surfaces never make a shared ancestor inert or install a pointer-blocking overlay. Automatic context compression remains canonical timeline presentation, but Flower exposes no manual compaction command.

# Contract

Ask User keeps explicit choice-versus-custom draft identity per question. Secret answers use a password field and are sent directly to Respond; they are excluded from ComposerDraft persistence, IndexedDB outbox, diagnostics, and timeline text. A successful response applies the returned current view immediately. Duplicate response requests resolve idempotently and never append duplicate user content.

Approval actions share one compact action row for batch rejection, rejection, one-time approval, and Stop. Every pending, requested primary approval remains visible even when its action reports `can_approve=false`, the adapter cannot mutate, the selected thread is read-only, or detail is pending; those states disable every decision action and present the canonical unavailable or read-only reason instead of falling back to chat. Accept or Reject calls the typed interaction boundary and applies its current view. Rejection is a quiet tool-row outcome. Batch rejection resolves only the listed pending interactions. The approval surface does not mount the ordinary textarea, password input, attachment or reference lane, working-directory, permission, model, reasoning, context-usage, or composer-footer controls. Per-thread text, attachment, and reference drafts remain owned by `ComposerDraftStore` while unmounted and return unchanged when the last approval resolves back to chat. Stop remains available directly in the approval action row instead of depending on the ordinary composer footer. No local handoff, consumed-interaction set, approval generation, or command busy reducer controls canonical visibility.

Automatic context compression may render canonical checkpoint dividers and usage. It is initiated by Floret context policy, not a slash command or composer action. Runtime restart recovery is quiet unless content cannot be recovered, in which case the affected row offers a nonblocking retry.

# Evidence

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Input, approval, composer, and navigation behavior.
- `redeven:internal/flower_ui/src/composer/createFlowerComposerDraftCoordinator.ts` - Per-thread choice/custom draft state.
- `redeven:internal/flower_ui/src/transportOutbox.ts` - Ordinary input persistence boundary.
- `redeven:internal/flower_ui/src/chat/FlowerContextCompactionDivider.tsx` - Canonical automatic compression presentation.
