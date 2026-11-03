---
type: UI Contract
title: Flower approval surface
tags: [ui, flower, approval, accessibility]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Shared Flower renders keyed canonical approvals within chat space with reachable header/footer. Runtime owns identity/permission/settlement; UI disclosure/feedback. Unavailable pending items remain disabled with reasons; failure preserves content, Stop and navigation.

# Contract

## Reading and layout
Single/multiple approvals share one flat list. Rows pair safe operation labels with independent Reject/Allow once capsules and actual risk/targets/reasons. After input advances to approval, focus the first enabled decision or Stop.

## Canonical decisions and drafts
Primary requested approvals remain visible when `can_approve=false`, adapters cannot mutate, thread is read-only or detail is pending. Disable every decision with canonical/read-only reason. Local handoff, consumed sets, generations or busy reducers cannot own visibility.

Result content loss and child attention do not themselves create parent confirmation controls. The UI shows canonical tool Activity and actual input/approval requests; only real model-requested observation produces verification activity. Previously saved requests remain visible and answerable.

## Safe presentation
One pure presenter owns trusted operation/title/description/command/target/risk fields. Localized fallbacks are independent strings, never parsed from translated sentences; internal names/encoding prefixes remain hidden.

# Boundaries

[Flower interactions and context state](flower-approval-context.md) owns the shared input/approval/chat priority and interaction submission guard. This presentation cannot grant permission, infer risk from command names, settle interactions locally, or change the typed Respond API.

# Evidence

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Source.
- `redeven:internal/flower_ui/src/flowerApprovalPresentation.ts` - Source.
