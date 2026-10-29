---
type: UI Contract
title: Env App page loading continuity
tags: [ui, startup, lifecycle, workbench]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

One product presentation registry declares initial loading and reload eligibility for every built-in Activity page and Workbench widget. Modules load inside their own surface, preserving existing successful content. Data services own readiness; access/authentication changes override retention, and loading never grants permission.

# Contract

## One display rule
Without a successful result, retain initial presentation until authoritative data or an actionable error arrives. Mutation, attachment, maintenance and plugin execution progress remain separate from inventory loading.

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

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPageLoading.tsx` - Exhaustive shared presentation registry.

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Activity module and access-check entry.
