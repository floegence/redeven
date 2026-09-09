---
type: UI Contract
title: Web Services interface
description: Read current service facts, open services, and resolve exceptions in compact Activity and Workbench surfaces.
tags: [architecture, ui, desktop, accessibility]
timestamp: 2026-09-09T00:00:00Z
---
# Summary

The shared Web Services interface presents the service identity, current backend status, available action, and supporting facts in that order. Activity and Workbench use the same collection and management drawer. Content must remain readable and actionable at narrow surface widths, with long translations and enlarged text. Historical failures cannot replace observed state. Failed checks preserve previously loaded facts with a visible explanation; unavailable actions retain an actionable inspection path within existing permissions.

# Contract

## Collection

Header, launcher, toolbar, and collection share a centered axis. The header has a short wrapping description plus template and creation actions; the launcher stays 40px high with input errors beneath it. Search, the counted archive menu, and refresh sit beside the collection title. Detached services and retained data have distinct archive views with a return action and an archive-specific empty state.

Managed and ordinary services share one neutral divided list with content-sized, aligned action tracks. Rows have a 72px minimum, never a fixed height. Identity owns the name, one current release, workspace basename, and access mode; current-release details remain available from the version control. Update and preview hints sit with that version. Backend status remains a short semantic label; current explanations occupy a wrapping support region inside the affected row. The owning surface's container width controls responsive placement, including narrow Workbench widgets inside wide windows. Open keeps its position among active services, while archived records expose their applicable management entry. The [management recovery contract](service-management-recovery.md) owns confirmed actions and resource authority.

Previously loaded collection facts survive an unsuccessful refresh with an explicit stale-check explanation. Forward ordering uses creation identity instead of health or last-opened time, so opening and refresh do not reorder rows. Managed snapshots retain service-ID-keyed DOM. Hover feedback is 120ms, state color feedback 180ms, and explanatory expansion 220ms; refresh never replays row entry. Reduced motion removes these transitions without removing focus, progress, or status feedback. Diagnostics and per-service operation presentation follow the [operation progress contract](managed-service-operation-progress.md).

## Review and focus

One drawer contains a current conclusion, compact resource facts, and recommended actions. Its shared Dialog footer keeps the confirmed execution and its impact visible while the body scrolls. Alternative goals change the reviewed plan inside the same drawer. Reference relations and technical identities expand in place; the workspace path remains visible and copyable. The selected service is highlighted while the drawer is open. Closing restores its surviving trigger; removing the record falls back to a neighboring service or the collection heading. Errors are readable without hover. Rechecking retains previously checked facts and their timestamp, but the previous digest cannot execute during loading or after a failed check.

The last reviewed identity and facts remain visible during exit, avoiding an empty-content flash. The existing Floe Dialog owns the surface boundary, keyboard trap, 240ms entry and 180ms exit. Its footer remains visible while resource facts scroll. References disclose their related instances only when expanded. Advanced actions and recent operation diagnostics remain progressive disclosure rather than permanent collection warnings.

# Boundaries

The renderer maps existing backend status and capabilities to short localized labels and semantic icons. It does not infer alternate lifecycle actions, change Registry state, bypass confirmation, or create another operation framework. Request submission appears immediately in the owning row; backend progress replaces it after acceptance. A rejected submission stays in the existing operation presentation with a safe localized explanation, without changing observed state or manufacturing a backend operation. Opening transactions are scoped to their target; unrelated service actions and navigation remain available.

Opening and authorization follow [Web Service browser sessions](web-service-browser-sessions.md). Resource preflight and execution follow [management recovery](service-management-recovery.md); streaming and historical operation ownership follow [operation progress](managed-service-operation-progress.md). Styling stays inside Web Services, reuses published components and theme variables, and adds no animation dependency.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx` - Shared collection, per-target opening, archive navigation, and refreshed facts.
- `redeven:internal/envapp/ui_src/src/ui/pages/ManagedServiceManagementDrawer.tsx` - Reviewed actions, compact resource facts, and persistent execution footer.
- `redeven:internal/envapp/ui_src/src/ui/pages/web-services.css` - Container-based layout, semantic surfaces, and reduced-motion handling.
- `redeven:internal/envapp/ui_src/src/ui/pages/WebServicesPage.browser.test.tsx` - Locale, theme, zoom, archive, focus, failure, and operation outcome checks.
- `redeven:internal/envapp/ui_src/src/ui/pages/WebServiceCollection.browser.test.tsx` - Real element boundaries and actionable exception rows inside narrow surfaces.
