---
type: UI Contract
title: Page loading, asynchronous feedback and document recovery
tags: [ui, startup, lifecycle, workbench]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Retain successful same-resource content through refresh while initial loads occupy final geometry. Refresh preserves successful same-resource content, including empty results. Equal items retain DOM identity, focus, expansion and scroll; pagination progress stays at the end.

# Contract

## Page continuity
Without a successful result, retain initial presentation until authoritative data/actionable error. Keep mutation, attachment, maintenance and plugin execution progress separate from inventory loading.

Use existing header/action indicators, accessible out-of-flow status or geometry-neutral local overlays. Never insert additional loading, cached-result or refresh-status text into normal flow: pending, stale, failed and recovered states cannot add rows, move existing controls/content or change their width. Do not reserve an empty status row as a workaround.

Initial reads use structural placeholders in final geometry. Editors/previews/settings retain bounded responsive body viewports with reachable headers/close/footer. Use published Floe components/theme tokens without arbitrary delays/height animations.

Runtime/resource/source identity scopes retention. Navigation, replacement and access loss invalidate it and fence late replies. Preserve unsaved same-resource drafts; submission requires readiness/permission. Unknown Runtime status is pending, never missing installation. Canvas opening is separate from library initialization: keep the selected card until arrival. Failed file-preview requests show their requested path/retry in the same viewport, never previous-file results. Expose real progress/permission failures/errors.

- Host Applications/Web Services/Containers/Codespaces use shared frames/skeletons; [resource cache](env-resource-cache.md) owns snapshots/refresh/fencing.
- Files keeps real workspace chrome with blank regions until the directory owner admits its first valid response.
- Terminal/Monitoring use shared status until catalog/first live sample/error, retaining content on later attachment/polling. Metrics are not inventory.
- Settings/Flower/Tessiven/Plugin Center/dynamic plugins use shared module status; resource/runtime/lifecycle owners govern readiness/errors.

`ENV_PAGE_PRESENTATIONS` exhaustively covers `BuiltinActivityPage` loading/reload policies in Activity and Workbench. [Filesystem navigation](filesystem-picker-navigation.md) retains its security boundary.

## Connection continuity
An admitted same-resource workspace stays mounted and locally interactive through recoverable transport loss, including Flower drafts, pane placement and plugin drawers. A compact accessible status exposes stop/resume/retry and technical details on demand. Remote commands and submissions still require the current published session and permission; unavailable session HTTP rejects without queuing a later mutation. Initial loading, revoked access and terminal recovery failure retain their blocking surfaces. Completion does not add a success-overlay delay.

## Asynchronous layout
Use published Button loading slot/`icon`; changing labels use `StableText` with every localized transient/completion/failure label. Host preparation has independently scrolling body/persistent action baseline. Unknown image dimensions use bounded 16:9 contain sizing; long diagrams/render errors scroll in reserved viewports.

Template discovery keeps its refresh label and icon slot fixed; loading uses the published Button spinner, failure uses its warning icon, and details remain in an out-of-flow tooltip plus an accessible live description. Retry stays on the same button. Initial reads use the existing catalog skeleton; successful empty catalogs remain empty during refresh. Reserve scrollbar gutters on scrolling bodies so placeholder/content changes cannot shift their chrome horizontally.

## Reload geometry
HTML head installs Floe's independent `reload-placeholder` before external modules/styles. It serializes no HTML, resource text, images, inputs, URLs or permissions and invents no resource count. Shared page registry governs reload eligibility; [Activity navigation](activity-navigation-restoration.md) owns selection. Fresh authoritative data may change final layout.

## Asset recovery
Capture document ESM entry URLs with published `createDocumentAssetRecovery`; unobtrusive notice reports updated/unavailable content. Retain authenticated route and explicit user reload. Never retain old bundles, rewrite module names or serve HTML as JavaScript.

# Boundaries

Loading stays local to page/widget; never replace unrelated mounted content, the canvas or successful results. Authentication/access loss outranks retention, which grants no permission.

Normal-state acceptance measures actual content tops, including charts and session table: stable empty feedback lanes/margins cannot pass. Validate published dependencies without aliases/overlays.

Remembered geometry conveys no resource data/authority; unavailable storage cannot block startup or hide recovery. Transport readiness proves neither current nor loadable assets. Build/import failures expose recovery without reloading over unsaved work or changing authentication/Desktop process identity.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.templateContinuity.browser.test.tsx` - Actual template drawer geometry, input identity/focus, selection, scroll and tooltip bounds through initial/cache/refresh/failure/recovery; Host, Container and Compose at desktop and narrow localized sizes, including empty snapshots.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.settingsDialog.browser.test.tsx` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/pages/GitTemplateImport.browser.test.tsx` - Fixed preview region and failed different-file retry.
- `redeven:internal/envapp/ui_src/src/styles/tessiven-runtime-dialog-continuity.browser.test.tsx` - Library card/focus retention through delayed or failed opening.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPageLoading.tsx` - Source.
