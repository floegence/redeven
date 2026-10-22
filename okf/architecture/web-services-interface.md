---
type: UI Contract
title: Web Services interface
description: Read current service facts, open services, and resolve exceptions in compact Activity and Workbench surfaces.
tags: [architecture, ui, desktop, accessibility]
timestamp: 2026-09-09T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The shared Web Services interface presents the service identity, current backend status, available action, and supporting facts in that order. Activity and Workbench use the same collection and management drawer. Content must remain readable and actionable at narrow surface widths, with long translations and enlarged text. Historical failures cannot replace observed state. Failed checks preserve previously loaded facts with a visible explanation; unavailable actions retain an actionable inspection path within existing permissions.

Local inventory continuity follows [Env App resource snapshots](../ui/env-resource-cache.md); presentation restoration grants no lifecycle or route authority.

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

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx` - Shared collection, per-target opening, archive navigation, and refreshed facts.

- `redeven:internal/envapp/ui_src/src/ui/pages/ManagedServiceManagementDrawer.tsx` - Reviewed actions, compact resource facts, and persistent execution footer.

- `redeven:internal/envapp/ui_src/src/ui/pages/web-services.css` - Container-based layout, semantic surfaces, and reduced-motion handling.
