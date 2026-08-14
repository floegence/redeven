---
type: UI Contract
title: Flower interactions and context state
description: Typed pending interactions, automatic context compression, and unlocked composer behavior.
tags: [ui, flower, approval, input, context]
timestamp: 2026-08-14T00:00:00Z
---
# Summary

Approval and waiting-user prompts are projections of Floret typed pending interactions. Their controls coexist with the ordinary thread rail and composer; they never make a shared ancestor inert or install a pointer-blocking overlay. Automatic context compression remains canonical timeline presentation, but Flower exposes no manual compaction command.

# Contract

Ask User keeps explicit choice-versus-custom draft identity per question. Secret answers use a password field and are sent directly to Respond; they are excluded from ComposerDraft persistence, IndexedDB outbox, diagnostics, and timeline text. A successful response applies the returned current view immediately. Duplicate response requests resolve idempotently and never append duplicate user content.

Approval actions share one compact action row. Accept or Reject calls the typed interaction boundary and applies its current view. Rejection is a quiet tool-row outcome. Batch rejection resolves only the listed pending interactions. No local handoff, consumed-interaction set, approval generation, or command busy reducer controls canonical visibility.

Automatic context compression may render canonical checkpoint dividers and usage. It is initiated by Floret context policy, not a slash command or composer action. Runtime restart recovery is quiet unless content cannot be recovered, in which case the affected row offers a nonblocking retry.

# Evidence

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Input, approval, composer, and navigation behavior.
- `redeven:internal/flower_ui/src/composer/createFlowerComposerDraftCoordinator.ts` - Per-thread choice/custom draft state.
- `redeven:internal/flower_ui/src/transportOutbox.ts` - Ordinary input persistence boundary.
- `redeven:internal/flower_ui/src/chat/FlowerContextCompactionDivider.tsx` - Canonical automatic compression presentation.
