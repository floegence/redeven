---
type: UI Contract
title: Redeven loading and layout continuity
tags: [ui, startup, lifecycle, workbench]
lifecycle: contract
reviewed_at: "2026-10-29"
---
# Summary

One product presentation registry declares initial loading and reload eligibility for every built-in Activity page and Workbench widget. Modules load inside their own surface, preserving existing successful content. Data services own readiness; access/authentication changes override retention, and loading never grants permission.

# Contract

## One display rule
Without a successful result, retain initial presentation until authoritative data or an actionable error arrives. Mutation, attachment, maintenance and plugin execution progress remain separate from inventory loading.

## Stable geometry and retained state

Pending reads must not insert temporary rows above successful content. Use the existing action/header indicator, an accessible status outside normal flow, or a local overlay that does not alter geometry. Preserve successful same-resource lists/forms during refresh, including a successfully empty result. Equal returned items retain DOM identity, keyboard focus, expansion and scroll. Pagination keeps progress at the list end.

Initial reads use structural placeholders inside the final content region. Data-dependent editors, file previews and settings dialogs keep a responsive bounded body viewport; headers, close controls and footers stay reachable while the body scrolls. Use published Floe components and theme tokens. Do not add arbitrary delays or height animations to disguise changes.

Retention is scoped to authoritative runtime/resource/source identity. Navigation, source replacement and access loss invalidate the relevant retained state and fence late responses. Retained forms cannot submit before readiness/permission checks succeed. Keep unsaved drafts across same-resource rereads without applying stale responses to a different target. Unknown runtime status is pending, never evidence that installation is missing.

Canvas opening has a separate pending state from library initialization; keep the selected library card mounted until the canvas arrives. A file-preview request owns its path: on failure show that path with retry in the same viewport, never the previous file as the requested result. Real mutation progress, permission failures and actionable errors remain explicit.

## Page ownership
- Host Applications, Web Services, Containers and Codespaces: shared frames/list skeletons; [resource cache](env-resource-cache.md) owns snapshots, refresh and fencing.
- Files: real workspace chrome with blank regions until its first valid directory; the directory owner rejects stale responses.
- Terminal/Monitoring: shared status until catalog/first live sample or error; later attachment/polling preserves content. Metrics are not inventory snapshots.
- Settings, Flower, Tessiven, Plugin Center and dynamic plugin pages: shared module status; existing resources/runtime/lifecycle owners govern operational readiness and errors.

## Activity and Workbench
`ENV_PAGE_PRESENTATIONS` in `EnvPageLoading` exhaustively covers `BuiltinActivityPage`. New built-ins must declare loading and reload policy. [Filesystem navigation](filesystem-picker-navigation.md) retains its security boundary.

# Boundaries

Loading stays inside the selected page or widget. It cannot replace an unrelated mounted page, the whole Workbench canvas or a successful retained result. Access denial and authentication changes take precedence; retained content does not grant permission.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.settingsDialog.browser.test.tsx` - Delayed reads, failures/retry, stationary controls and bounded dialog geometry at desktop/phone widths.
- `redeven:internal/envapp/ui_src/src/ui/FlowerTaskFiles.browser.test.tsx` - Pagination, equal-row identity, empty-state refresh and runtime/thread fencing.
- `redeven:internal/envapp/ui_src/src/ui/flower/FlowerExtensions.browser.test.tsx` - Catalog retention/source invalidation plus responsive localized extension dialogs.
- `redeven:internal/envapp/ui_src/src/ui/pages/ManagedServiceSettingsDesign.browser.test.tsx` - Draft retention, stale read rejection and initial failure recovery.
- `redeven:internal/envapp/ui_src/src/ui/widgets/DirectoryFavoritesSection.browser.test.tsx` - Following tree position across load, refresh, filtering and empty states.
- `redeven:internal/envapp/ui_src/src/ui/pages/GitTemplateImport.browser.test.tsx` - Fixed preview region and failed different-file retry.
- `redeven:internal/envapp/ui_src/src/styles/tessiven-runtime-dialog-continuity.browser.test.tsx` - Library card/focus retention through delayed or failed opening.

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPageLoading.tsx` - Exhaustive shared presentation registry.

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Activity module and access-check entry.
