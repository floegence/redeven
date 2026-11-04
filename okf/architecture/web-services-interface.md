---
type: UI Contract
title: Web Services interface
tags: [architecture, ui, desktop, accessibility]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Activity/Workbench share service list/drawer: identity, state, action, facts. Retain narrow/localized/large-text usability. Historical failure never replaces current state; failed checks preserve facts and authorized recovery. Resource cache grants no lifecycle or route authority.

# Contract

## Collection
Centered header/launcher/toolbar/list. Rows have 64px minimum, not fixed height. Bounded status isolates async feedback under [layout stability](../ui/page-loading-continuity.md#asynchronous-layout); narrow/localized text wraps.

## Opening restrictions
Unavailable Open retains its ordinary icon and native disabled state. Focusable wrapper exposes reason on keyboard/touch/hover; active work names action/stage. When backend offers executable Start, it is primary within existing permissions.

## Review and focus
One drawer shows conclusion, compact resources and recommended actions. New known inventory may replace old inspection; unknown preserves facts. Older/unknown targets retain stop-first then explicit update. Originally stopped services remain stopped after update.

## Templates and versions
Template categories use published Floe Tabs with paired selection colors, roving keyboard focus and a labelled panel. Product styles never override tab ink. Template lists use compact rounded rows with source groups; the wider detail pane keeps deployment facts, runtime details and actions together. Dropdown wrappers own the sole focus target and disabled state.

Both template and installed-service versions use the same bounded directory/detail workspace. Rows emphasize version and state; the selected detail owns trust, source, platform and expandable artifact identity. Current releases retain useful provenance. Narrow layouts stack independently scrollable panes, while request feedback and submission remain outside the list. Refresh and verification preserve selection, focus, scroll and footer geometry. Confirmation, stop-first and update authorization remain unchanged. Selection motion is brief and local; reduced motion removes travel.

## Execution feedback
Execution details keep one bounded command/output viewport. Downloaded bytes remain visible when the total is unknown; unknown totals keep the byte bar indeterminate. Speed is shown once measured bytes are available, while fully cached pulls show zero transfer. Layer counts remain separate. New output does not expand the panel or move a reader away from earlier lines.

# Boundaries

The renderer maps existing backend status and capabilities to short localized labels and semantic icons.

Specific entrance errors remain readable; failed Open never prevents another attempt.

The shell retains only collection and loading-presentation styles; management and version-review styles load with the product page rather than the initial document graph.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/pages/ServiceCatalogDesign.browser.test.tsx` - Classic/Porcelain light/dark, desktop/narrow contrast, keyboard, accessibility and reduced-motion acceptance.
- `redeven:internal/envapp/ui_src/src/ui/pages/ManagedServiceVersions.browser.test.tsx` - Version verification, consent, stop-first, update and Workbench continuity.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx` - Product presentation.
- `redeven:internal/envapp/ui_src/src/ui/pages/WebServiceCollection.browser.test.tsx` - Disabled Open tooltip keyboard/touch behavior.
- `redeven:internal/envapp/ui_src/src/ui/pages/ManagedServiceOperation.browser.test.tsx` - Desktop/narrow, light/dark, localized fixed-height output and real-Docker-recorded transfer fixture.
