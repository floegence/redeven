---
type: UI Contract
title: Web Services interface
tags: [architecture, ui, desktop, accessibility]
lifecycle: contract
reviewed_at: "2026-11-06"
---
# Summary

Activity/Workbench share service list/drawer: identity, state, action, facts. Template previews show source, version, access mode and disk requirements. A closed keyboard disclosure retains technical identity/endpoints/lifecycle/paths; commands and installation steps are never expanded by default.

# Contract

## Collection
Centered header/launcher/toolbar/list. Rows have minimum64px, never fixed height; narrow/localized text wraps. [Layout stability](../ui/page-loading-continuity.md#asynchronous-layout) owns async status.

## Opening restrictions
Unavailable Open retains ordinary icon/native disabled state; focusable wrapper explains why on keyboard/touch/hover. Name actual action/stage. Executable permitted Start becomes primary.

## Review and focus
One drawer presents conclusion, compact resources and actions. Known inventory may replace old inspection; unknown preserves facts. Older/unknown targets retain stop-first and explicit update; originally stopped services remain stopped.

## Templates and versions
Published Floe Tabs own colors, roving focus and labelled panels. Compact source-grouped rows lead to wider deployment/runtime/action details. Dropdown wrappers own the sole focus target/disabled state. Omit redundant available-success copy; retain installed/unavailable reasons. Return from review preserves selection/focus; template changes reset disclosure.

Host/Container/Compose details, install, editing, GitHub import and version review share a fixed desktop action edge: secondary/navigation then right-aligned bounded primary, published large36px buttons. Narrow layouts preserve reading/keyboard order, wrap whole controls, put secondary above full-width primary and use >=44px targets. More matches adjacent outline/radius. Title/categories replace instructions.

Template and installed versions share bounded directory/detail panes: version/state rows, selected trust/source/platform and expandable artifact identity, including current provenance. Narrow panes scroll separately; feedback/submission remain outside the list. Refresh/verification retain selection/focus/scroll/footer. Existing confirmation/stop-first/update authority remains; motion is brief/local or immediate when reduced.

## Installation feedback
Compact form shows service/environment, selected version/change and complete wrapping path/folder action. Avoid duplicate facts, recommendation cards and default explanations. Optional facts/access mode use a closed disclosure summarized by selected mode; published button radios preserve keyboard. Required acknowledgements/advisories/custom-workspace warnings stay outside.

Complete inputs/consent automatically prepare an effect-free local plan. Display resolved directory before single Deploy; no extra manual review/success message. Edits immediately invalidate admission; expiry renews in place without path movement. Inline checking/errors retain footer; failures offer Retry. Close/reopen/identity/permission changes fence stale replies. Deployment needs a fresh click bound to the exact plan. Keep return/close, with narrow Deploy after return on its own row.

Final submission returns immediately to collection with appended accessible status row; admission proceeds independently. Accepted operation supplies validation/environment/deployment progress before inventory. Filters cannot hide it. Status explicitly opens details; completion opens nothing automatically. Rejection offers fresh review; uncertainty looks up the receipt; accepted failures use service recovery. [Progress](managed-service-operation-progress.md#install-admission-and-handoff) owns handoff.

## Execution feedback
One bounded command/output viewport retains earlier reader position. Unknown totals show transferred bytes and indeterminate bar; measured bytes enable speed, fully cached pulls show zero transfer. Layer counts remain separate.

# Boundaries

Map backend facts/capabilities into localized labels/icons. Entrance errors remain readable without blocking another attempt. Initial shell loads collection/loading styles only; management/version styles load with the page.

# Evidence

WebServicesPage.browser.test.tsx covers themes, localized paths, keyboard/accessibility/consent, preparation/retry/handoff and desktop/narrow layouts. managedServiceInstallPreparation.test.ts verifies exact inputs, stable paths, expiry/fencing/effect-free retry. ManagedServiceOperation.browser.test.tsx verifies fixed output using recorded Docker transfers.
