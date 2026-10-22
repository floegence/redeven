---
type: UI Contract
title: Flower interactions and context state
description: Typed pending interactions, automatic context compression, and unlocked composer behavior.
tags: [ui, flower, approval, input, context]
timestamp: 2026-09-25T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Approval and waiting-user prompts are projections of Floret typed pending interactions. The bottom action mode is one mutually exclusive surface with fixed priority `input_request` then `approval` then `chat`, while the ordinary thread rail always remains interactive; decision surfaces never make a shared ancestor inert or install a pointer-blocking overlay.

# Contract

## Answering questions
Ask User keeps explicit choice-versus-custom draft identity per question. Secret answers use a password field and remain only in the volatile draft coordinator until canonical resolution or cancellation.

Unaccepted or cancelled input does not create a user receipt.

## Approving actions
The [Flower approval surface](flower-approval-surface.md) owns the approval list, bounded layout, disclosure, focus, exact batch membership, and presentation contract. It shares the interaction submission guard and canonical reconciliation boundary described above.

## Context and recovery
Runtime restart recovery is quiet unless content cannot be recovered, in which case the affected row offers a nonblocking retry. All shipped locales provide the same distinction; keyboard users can focus the circle and dismiss its details with Escape.

# Boundaries

The decision surface owns drafts, disabled reasons, focus, and row-local commands only. It cannot authorize from rendered state, persist secret answers, settle an interaction locally, create a lifecycle row, or block navigation. Floret's typed current view remains the canonical interaction and tool outcome authority.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/InterfaceCoordination.browser.test.tsx` - Compact question bounds, touch targets, scrolling, and retained selection.

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Input, approval, composer, and navigation behavior.

- `redeven:internal/flower_ui/src/inputResponse.ts` - Strict settled-input response contract and live projection.
