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
Centered header/launcher/toolbar/list. Rows have 64px minimum, not fixed height. Bounded status isolates async feedback under [layout stability](../ui/asynchronous-layout-stability.md); narrow/localized text wraps.

## Opening restrictions
Unavailable Open retains its ordinary icon and native disabled state. Focusable wrapper exposes reason on keyboard/touch/hover; active work names action/stage. When backend offers executable Start, it is primary within existing permissions.

## Review and focus
One drawer shows conclusion, compact resources and recommended actions. New known inventory may replace old inspection; unknown preserves facts. Older/unknown targets retain stop-first then explicit update. Originally stopped services remain stopped after update.

# Boundaries

The renderer maps existing backend status and capabilities to short localized labels and semantic icons.

Specific entrance errors remain readable; failed Open never prevents another attempt.

The shell retains only collection and loading-presentation styles; management and version-review styles load with the product page rather than the initial document graph.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx` - Product presentation.
- `redeven:internal/envapp/ui_src/src/ui/pages/WebServiceCollection.browser.test.tsx` - Disabled Open tooltip keyboard/touch behavior.
