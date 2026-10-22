---
type: UI Contract
title: Flower approval surface
description: Review bounded approval queues, inspect exact commands, and submit independent or atomic one-time decisions.
tags: [ui, flower, approval, accessibility]
timestamp: 2026-09-25T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Flower projects approvals from Floret typed current views through one compact list shared by Activity, the full page, Workbench, and Desktop. The actual chat container bounds the list while its header and decision footer remain visible. Approval identity, permissions, and completion remain canonical runtime concerns; local state owns disclosure and submission feedback only. Failures preserve the pending content and allow retry without blocking Stop or navigation.

# Contract

## Reading and layout
Approval uses one keyed flat list for both single and multiple actions. Each row pairs its safe operation label with independent Floe Reject and Allow once capsules; risk, actual file/network targets, and unavailable reasons remain visible.

After an input response advances to approval, the existing focus handoff prefers the first enabled decision and falls back to Stop when no decision is available.

## Canonical decisions and drafts
Every pending, requested primary approval remains visible even when its action reports `can_approve=false`, the adapter cannot mutate, the selected thread is read-only, or detail is pending; those states disable every decision action and present the canonical unavailable or read-only reason instead of falling back to chat.

No local handoff, consumed-interaction set, approval generation, or command busy reducer controls canonical visibility.

## Safe presentation
One pure presenter owns operation classification, title, description, command, targets, and risk. Operation fallbacks are independent localized strings and never extracted from translated sentences. Internal tool names and target-encoding prefixes are never user-facing.

# Boundaries

[Flower interactions and context state](flower-approval-context.md) owns the shared input/approval/chat priority and interaction submission guard. This presentation cannot grant permission, infer risk from command names, settle interactions locally, or change the typed Respond API.

# Evidence

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Canonical approval projection, per-interaction guards, batches, and focus handoff.

- `redeven:internal/flower_ui/src/FlowerApprovalRow.tsx` - Stable disclosure, exact copying, and row-local feedback.

- `redeven:internal/flower_ui/src/flowerApprovalPresentation.ts` - Trusted operation labels, targets, and risk fields.
