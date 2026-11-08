---
type: UI Contract
title: Web Services interface
tags: [architecture, ui, desktop, accessibility]
lifecycle: contract
reviewed_at: "2026-11-06"
---
# Summary

Activity/Workbench share service list/drawer: identity, state, action, facts. Host template previews show identity, source/preview state and the version, access mode and disk requirement needed to choose a deployment. A closed keyboard-operable technical disclosure retains revision, paths, endpoint and lifecycle facts; installation steps and commands are never expanded by default.

# Contract

## Collection
Centered header/launcher/toolbar/list. Rows have 64px minimum, not fixed height. Bounded status isolates async feedback under [layout stability](../ui/page-loading-continuity.md#asynchronous-layout); narrow/localized text wraps.

## Opening restrictions
Unavailable Open retains its ordinary icon and native disabled state. Focusable wrapper exposes reason on keyboard/touch/hover; active work names action/stage. When backend offers executable Start, it is primary within existing permissions.

## Review and focus
One drawer shows conclusion, compact resources and recommended actions. New known inventory may replace old inspection; unknown preserves facts. Older/unknown targets retain stop-first then explicit update. Originally stopped services remain stopped after update.

## Templates and versions
Template categories use published Floe Tabs with paired selection colors, roving keyboard focus and a labelled panel. Product styles never override tab ink. Template lists use compact rounded rows with source groups; the wider detail pane keeps deployment facts, runtime details and actions together. Dropdown wrappers own the sole focus target and disabled state.

Available host templates omit redundant success explanations; installed or unavailable reasons stay visible. Returning from install review retains the catalog selection and restores focus to its selected row; switching templates resets disclosure state, and desktop actions remain fixed while technical details scroll. Host, container and Compose previews share a fixed desktop action edge. Catalog details, install, template editing, GitHub import and version review use one action layout: secondary/navigation controls precede the right-aligned primary action, with the published large button size (36px at default density) and a bounded primary width. Narrow layouts keep that reading and keyboard order, pair secondary actions above a full-width primary row and provide at least 44px control height; localized controls wrap as whole actions without clipping labels. More uses the same outline treatment and radius as the neighboring buttons. The catalog title and category controls replace introductory instructions.

Both template and installed-service versions use the same bounded directory/detail workspace. Rows emphasize version and state; the selected detail owns trust, source, platform and expandable artifact identity. Current releases retain useful provenance. Narrow layouts stack independently scrollable panes, while request feedback and submission remain outside the list. Refresh and verification preserve selection, focus, scroll and footer geometry. Confirmation, stop-first and update authorization remain unchanged. Selection motion is brief and local; reduced motion removes travel.

## Installation feedback
The installation drawer uses a bounded compact form: service identity and environment, one selected version with its change action, then a complete wrapping workspace path with its folder action. Avoid repeated version facts, nested recommendation cards and default explanatory paragraphs. Optional deployment facts and access mode live in a closed disclosure whose summary shows the selected mode. Published Floe button radios retain native keyboard selection. Custom workspace warnings, release advisories and required template acknowledgements remain outside that disclosure.

Complete inputs and required consent automatically prepare the local install plan without deployment effects. Show its final directory before enabling the single Deploy action; there is no manual review step or redundant success message. Edits invalidate submission immediately, expiry renews in place, and the resolved directory remains stable across checks. Inline checking/error feedback preserves footer geometry; failed checks offer explicit retry. Closing, reopening, permission or identity changes discard stale responses. Deployment always needs a fresh user click against the current exact plan. The footer retains the template-list return and drawer close control; narrow layouts give Deploy its own full-width row after the return action, using the shared template action layout.

Final install returns immediately to the active collection with an appended submission row and accessible status focus, while admission runs independently. The accepted operation supplies version validation, environment checks and deployment progress even before a full list response. Search/archive filters cannot hide the new submission. Status explicitly opens execution details; completion does not force another drawer. Rejected requests support safe fresh review, uncertain responses support receipt lookup, and accepted failures use existing service recovery. See [operation progress](managed-service-operation-progress.md#install-admission-and-handoff).

## Execution feedback
Execution details keep one bounded command/output viewport. Downloaded bytes remain visible when the total is unknown; unknown totals keep the byte bar indeterminate. Speed is shown once measured bytes are available, while fully cached pulls show zero transfer. Layer counts remain separate. New output does not expand the panel or move a reader away from earlier lines.

# Boundaries

The renderer maps existing backend status and capabilities to short localized labels and semantic icons.

Specific entrance errors remain readable; failed Open never prevents another attempt.

The shell retains only collection and loading-presentation styles; management and version-review styles load with the product page rather than the initial document graph.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/pages/WebServicesPage.browser.test.tsx` - Compact installation across Classic/Porcelain light/dark and desktop/narrow layouts, localized path wrapping, keyboard selection, accessibility, consent, automatic preparation, inline retry and single-click collection handoff.
- `redeven:internal/envapp/ui_src/src/ui/pages/managedServiceInstallPreparation.test.ts` - Exact input binding, stable directories, expiry, stale-result fencing and effect-free retry.
- `redeven:internal/envapp/ui_src/src/ui/pages/ManagedServiceOperation.browser.test.tsx` - Desktop/narrow, light/dark, localized fixed-height output and real-Docker-recorded transfer fixture.
