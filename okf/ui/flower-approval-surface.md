---
type: UI Contract
title: Flower decisions, approval presentation and secret drafts
tags: [ui, flower, approval, accessibility]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Canonical Floret input and approval requests determine decision visibility and settlement. Shared row-local guards retain explicit choice/custom drafts, volatile secrets and safe operation facts. Read-only or unavailable controls remain visible with reasons; local rendering never creates permission or lifecycle.

# Contract

## Approval presentation
### Reading and layout
Single/multiple approvals share one flat list. Rows pair safe operation labels with independent Reject/Allow once capsules and actual risk/targets/reasons. After input advances to approval, focus the first enabled decision or Stop.

### Canonical decisions and drafts
Primary requested approvals remain visible when `can_approve=false`, adapters cannot mutate, thread is read-only or detail is pending. Disable every decision with canonical/read-only reason. Local handoff, consumed sets, generations or busy reducers cannot own visibility.

Result content loss and child attention do not themselves create parent confirmation controls. The UI shows canonical tool Activity and actual input/approval requests; only real model-requested observation produces verification activity. Previously saved requests remain visible and answerable.

### Safe presentation
One pure presenter owns trusted operation/title/description/command/target/risk fields. Localized fallbacks are independent strings, never parsed from translated sentences; internal names/encoding prefixes remain hidden.

## Input and context
### Answering questions
Ask User keeps explicit choice-versus-custom draft identity per question. Secret answers use a password field and remain only in the volatile draft coordinator until canonical resolution or cancellation.

Unaccepted or cancelled input does not create a user receipt.

### Approving actions
The [Flower approval surface](#approval-presentation) owns the approval list, bounded layout, disclosure, focus, exact batch membership, and presentation contract. It shares the interaction submission guard and canonical reconciliation boundary described above.

### Context and recovery
Runtime restart recovery is quiet unless content cannot be recovered, in which case the affected row offers a nonblocking retry. All shipped locales provide the same distinction; keyboard users can focus the circle and dismiss its details with Escape.

# Boundaries

[Flower interactions and context state](#input-and-context) owns the shared input/approval/chat priority and interaction submission guard. This presentation cannot grant permission, infer risk from command names, settle interactions locally, or change the typed Respond API.

The decision surface owns drafts, disabled reasons, focus, and row-local commands only. It cannot authorize from rendered state, persist secret answers, settle an interaction locally, create a lifecycle row, or block navigation. Floret's typed current view remains the canonical interaction and tool outcome authority.

# Evidence

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Source.
- `redeven:internal/flower_ui/src/flowerApprovalPresentation.ts` - Source.

- `redeven:internal/envapp/ui_src/src/ui/InterfaceCoordination.browser.test.tsx` - Tests.
