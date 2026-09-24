---
type: UI Contract
title: Flower approval surface
description: Review bounded approval queues, inspect exact commands, and submit independent or atomic one-time decisions.
tags: [ui, flower, approval, accessibility]
timestamp: 2026-09-25T00:00:00Z
---
# Summary

Flower projects approvals from Floret typed current views through one compact list shared by Activity, the full page, Workbench, and Desktop. The actual chat container bounds the list while its header and decision footer remain visible. Approval identity, permissions, and completion remain canonical runtime concerns; local state owns disclosure and submission feedback only. Failures preserve the pending content and allow retry without blocking Stop or navigation.

# Contract

## Reading and layout

Approval uses one keyed flat list for both single and multiple actions. Its quiet header states the pending count once. Each row pairs its safe operation label with independent Floe Reject and Allow once capsules; risk, actual file/network targets, and unavailable reasons remain visible. Supporting descriptions and working directories use native disclosures. Commands retain their exact original text and token highlighting, soft-wrap, and preview at most two lines. A measured truncation exposes View full command; expanding removes the clamp without adding another vertical scroll area. Copy always writes the entire original command. Disclosure and DOM identity survive current-view refreshes, companion collapse, resizing, and the transition from multiple approvals to one.

The actual chat body owns the approval height budget: at most 360 CSS pixels and 70% of its available height, or its full remaining height below 360 pixels. The header and footer stay outside the one constrained, scrollable list. In the 544-pixel companion, two ordinary commands fit within a 300-pixel approval surface. At a composer width of at least 420 pixels, row decisions share the title line; narrower rows place decisions after the preview. Narrow row and batch controls use two wrapping columns. Desktop row decisions are at least 28 pixels high and the primary batch action is at least 32 pixels; touch controls are at least 44 pixels. Typography and control roles follow the [shared interface scale](interface-scale.md). Long translations, enlarged text, errors, and command expansion must not push the footer outside the host. Env App supplies its existing Workbench scroll and text-selection markers to the list and reading regions; those markers do not grant unselected widgets wheel ownership.

The footer always exposes circular Stop and the one-time scope. Multiple approvals add exact-count batch decisions; a mixed-capability list separately names its eligible count. Submission feedback remains row-local, and failures remain inline with retryable decisions. Canonical resolution removes rows. If focus is still in a removed row, it moves to the next row's reading region, never automatically to Allow. External focus remains untouched. After an input response advances to approval, the existing focus handoff prefers the first enabled decision and falls back to Stop when no decision is available.

## Canonical decisions and drafts

Every pending, requested primary approval remains visible even when its action reports `can_approve=false`, the adapter cannot mutate, the selected thread is read-only, or detail is pending; those states disable every decision action and present the canonical unavailable or read-only reason instead of falling back to chat. Accept or Reject calls the typed interaction boundary and applies its current view. A resolved approval interaction never creates a standalone timeline row: its lifecycle state merges only into the canonical tool item with the same `tool_call_id`, and an unmatched resolved interaction renders no tool shell. Rejection is a quiet tool-row outcome. Batch approval and rejection submit the exact visible `interaction_ids` in one atomic Floret Respond. An in-flight single decision prevents a batch containing that decision; newly arriving approvals are not added to an already submitted set. A conflicting member rejects the whole batch. `interaction_id` and `interaction_ids` are mutually exclusive. The legacy `reject_all` request remains supported for existing API consumers only; the current UI never sends it.

The approval surface does not mount the ordinary textarea, password input, attachment or reference lane, permission, model, reasoning, context-usage, or composer-footer controls. Header [working-directory browsing](flower-working-directory-navigation.md) remains available independently of the approval composer. Per-thread text, attachment, and reference drafts remain owned by `ComposerDraftStore` while unmounted and return unchanged when the last approval resolves back to chat. Stop remains available directly in the approval footer instead of depending on the ordinary composer footer. No local handoff, consumed-interaction set, approval generation, or command busy reducer controls canonical visibility.

## Safe presentation

One pure presenter owns operation classification, title, description, command, targets, and risk. Operation fallbacks are independent localized strings and never extracted from translated sentences. Approval copy prefers the canonical safe label, then a distinct description, before a localized operation fallback. A label identical to the command is not repeated as a title. File and network targets remain visible, and internal tool identifiers never become titles. Generic write effects do not prove file mutation: only a known file mutation with its declared write effect uses the file warning. Command names never determine risk; computer write actions do not claim to write files. Internal tool names and target-encoding prefixes are never user-facing.

# Boundaries

[Flower interactions and context state](flower-approval-context.md) owns the shared input/approval/chat priority and interaction submission guard. This presentation cannot grant permission, infer risk from command names, settle interactions locally, or change the typed Respond API.

# Evidence

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Canonical approval projection, per-interaction guards, batches, and focus handoff.
- `redeven:internal/flower_ui/src/FlowerApprovalRow.tsx` - Stable disclosure, exact copying, and row-local feedback.
- `redeven:internal/flower_ui/src/flowerApprovalPresentation.ts` - Trusted operation labels, targets, and risk fields.
- `redeven:internal/flower_ui/src/styles/flower.css` - Container-relative height and the one scrolling viewport.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.approvalLayout.browser.test.tsx` - Published-shell geometry, density, disclosure, focus, and Workbench checks.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.decisionSurface.browser.test.tsx` - Authorization states, concurrency, exact batches, and draft restoration.
- `redeven:internal/ai/flower_approval_batch_test.go` - Runtime atomic batch membership, conflicts, and replay.
