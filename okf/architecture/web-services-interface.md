---
type: UI Contract
title: Web Services interface
tags: [architecture, ui, desktop, accessibility]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Activity/Workbench share service list/drawer: identity, state, action, facts. Retain narrow/localized/large-text usability. Historical failure never replaces current state; failed checks preserve facts and authorized recovery. Resource cache grants no lifecycle or route authority.

# Contract

## Collection
Header, launcher, toolbar, and collection share a centered axis.

Rows have a 64px minimum, never a fixed height.

The bounded status cell isolates asynchronous progress and explanatory feedback from neighboring rows under the [layout stability contract](../ui/asynchronous-layout-stability.md).

## Opening restrictions
When Open is unavailable and the backend selects an executable Start action, Start uses the primary button style within existing management permissions.

Long explanations wrap inside the visible boundary in either theme.

## Review and focus
One overlay drawer contains a concise service conclusion, compact resource facts, and recommended actions. A newer known inventory check may replace older inspection facts; unknown checks preserve the last known facts.

Older or unknown targets retain the stop-first flow and require a second explicit update after stopping; an initially stopped service remains stopped after update.

# Boundaries

The renderer maps existing backend status and capabilities to short localized labels and semantic icons.

Specific entrance errors remain readable; failed Open never prevents another attempt.

The shell retains only collection and loading-presentation styles; management and version-review styles load with the product page rather than the initial document graph.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/pages/web-services.css` - Source.
