---
type: UI Contract
title: Flower approval surface
description: Review bounded approval queues, inspect exact commands, and submit independent or atomic one-time decisions.
tags: [ui, flower, approval, accessibility]
timestamp: 2026-09-25T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Shared Flower renders canonical Floret approvals as a compact keyed list bounded by chat space with reachable header/footer. Runtime owns identity, permission and settlement; UI owns disclosure/submission feedback. Pending unavailable approvals stay visible with disabled decisions and reasons. Failures preserve content and keep Stop/navigation usable.

# Contract

## Reading and layout
Single/multiple approvals share one flat list. Rows pair safe operation labels with independent Reject/Allow once capsules and actual risk/targets/reasons. After input advances to approval, focus the first enabled decision or Stop.

## Canonical decisions and drafts
Primary requested approvals remain visible when `can_approve=false`, adapters cannot mutate, thread is read-only or detail is pending. Disable every decision with canonical/read-only reason. Local handoff, consumed sets, generations or busy reducers cannot own visibility.

## Safe presentation
One pure presenter owns trusted operation/title/description/command/target/risk fields. Localized fallbacks are independent strings, never parsed from translated sentences; internal names/encoding prefixes remain hidden.

# Boundaries

[Flower interactions and context state](flower-approval-context.md) owns the shared input/approval/chat priority and interaction submission guard. This presentation cannot grant permission, infer risk from command names, settle interactions locally, or change the typed Respond API.

# Evidence

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Canonical approval projection, per-interaction guards, batches, and focus handoff.

- `redeven:internal/flower_ui/src/FlowerApprovalRow.tsx` - Stable disclosure, exact copying, and row-local feedback.

- `redeven:internal/flower_ui/src/flowerApprovalPresentation.ts` - Trusted operation labels, targets, and risk fields.
