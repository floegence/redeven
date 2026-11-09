---
type: UI Contract
title: Page loading, asynchronous feedback and document recovery
tags: [ui, startup, lifecycle, workbench]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Initial loads occupy final geometry. Refresh retains successful same-resource content, including empty results, with stable item DOM/focus/expansion/scroll. Pagination feedback stays at the end.

# Contract

## Page continuity
Retain initial presentation until authoritative data or actionable error; inventory loading is separate from mutation/attachment/maintenance/plugin execution. Use existing action indicators, accessible out-of-flow status or geometry-neutral overlays. Pending/stale/failed/recovered states add no rows or width changes; an empty reserved status lane is not a workaround.

Use structural placeholders and bounded responsive bodies with reachable header/close/footer, published Floe components and no arbitrary delay/height animation. Runtime/resource/source identity scopes retention; replacement/access loss fences late replies. Preserve same-resource drafts, but submit only with current readiness/permission. Unknown Runtime is pending, not missing. Library initialization cannot erase a selected canvas card before arrival. Failed preview shows the requested path/retry, never previous-file content.

Host Apps/Services/Containers/Codespaces use shared frames and [resource snapshots](env-resource-cache.md). Files keeps workspace chrome until first directory response. Terminal/Monitoring retain content after initial catalog/sample/error; metrics are not inventory. Settings/Flower/Tessiven/Plugin Center/plugins share module status with feature-owned readiness. ENV_PAGE_PRESENTATIONS exhaustively maps Activity/Workbench BuiltinActivityPage loading/reload; [filesystem navigation](filesystem-picker-navigation.md) retains security.

## Connection continuity
Admitted same-resource workspaces stay mounted and locally usable through recoverable transport loss, including drafts/panes/plugin drawers. Compact accessible status exposes stop/resume/retry and optional details. Current session/permission still gates remote commands; unavailable HTTP never queues a later mutation. Initial loading, revoked access and terminal recovery failures remain blocking. No completion-overlay delay.

## Asynchronous layout
Published Button owns spinner/icon; StableText includes every localized transient/result label. Preparation body scrolls independently of fixed actions. Unknown images use bounded 16:9 contain regions; diagrams/errors scroll in reserved viewports. Template refresh retains label/icon slot, uses warning/spinner, and exposes failure details out of flow plus live description; Retry is the same button. Empty catalogs stay empty during refresh. Reserve scrollbar gutters, not status lanes.

## Reload geometry
Install independent Floe reload-placeholder in HTML head before modules/styles. It stores no HTML/content/images/inputs/URLs/permissions and invents no resource count. Shared page registry and [Activity restoration](activity-navigation-restoration.md) own eligibility/selection; fresh data may change final layout.

## Asset recovery
Published createDocumentAssetRecovery captures entry URLs and exposes unobtrusive updated/unavailable notice with explicit reload. Preserve authenticated route; never retain old bundles, rewrite names or serve HTML as JavaScript.

# Boundaries

Loading remains local; access loss outranks retention. Acceptance measures real content tops (charts/session tables), not empty feedback margins. Use published dependencies without overlays. Remembered geometry grants no data/authority; storage failure cannot block recovery. Transport readiness proves no asset validity. Import/build failures cannot auto-reload over drafts or change authentication/process identity.

# Evidence

EnvPortForwardsPage.templateContinuity.browser.test.tsx measures real drawer/input/focus/selection/scroll/tooltip bounds across cache/failure/recovery, Host/Container/Compose and localized narrow/desktop/empty states. FlowerSurface.settingsDialog, GitTemplateImport and tessiven-runtime-dialog-continuity browser suites cover retained settings, failed new-file previews and canvas arrival. EnvPageLoading.tsx owns frames.
