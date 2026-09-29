---
type: UI Contract
title: Env App page loading continuity
description: Apply one initial-loading and refresh policy across Activity pages and Workbench widgets.
tags: [ui, startup, lifecycle, workbench]
timestamp: 2026-09-23T00:00:00Z
---
# Summary

Redeven owns a single page-presentation registry over published Floe lifecycle,
loading, and layout APIs. Every built-in Activity page declares its initial
presentation and document-reload eligibility in that registry. Activity and
Workbench consume the same declaration. Module loading must stay inside the
selected page or widget; it cannot replace another mounted page, the whole
canvas, or an existing successful result. Data services retain their existing
authority. Access denial and authentication changes take precedence over retained
content; ordinary loading does not grant permission or clear content.

# Contract

## One display rule

A page without a successful result shows its initial presentation until data or
an actionable error is ready. Module and first-data loading use the same visual
form. A successful empty result is content. Once present, content stays mounted
through refresh, polling, and ordinary reconnection. Relevant refresh controls
may indicate work, while errors use the existing recovery location. A confirmed
identity or permission change revokes the old display through its existing owner.

Initial presentation is not a second data state machine. It does not copy request
state, delay resource completion, start polling, or introduce additional retries.
Pages derive readiness from their authoritative data. Transient mutations,
terminal attachment, runtime maintenance, and plugin execution retain their own
progress and confirmation contracts; they are not directory or inventory loads.

## Page ownership

| Surface | Initial presentation and data authority |
| --- | --- |
| Host Applications, Web Services, Containers, Codespaces | Shared page frames and list skeletons; the resource cache owns restoration, successful snapshots, refresh, and request fencing. |
| Files | Actual workspace chrome with blank content regions until the first successful directory result; the directory owner commits valid snapshots and rejects stale responses. |
| Terminal | Shared initial status until the session catalog resolves; the terminal runtime owns subsequent creation and attachment. |
| Monitoring | Shared initial status until the first live sample or error; subsequent polling preserves charts and current content. Metrics are not persisted as inventory snapshots. |
| Settings | Shared module status; existing settings resources retain values during refresh and each section owns its form. |
| Flower | Shared module status; its readiness and workspace-stream owners govern operational content and actionable maintenance. |
| Plugin Center and dynamic plugin pages | Shared module status; the inventory and published plugin surface lifecycle retain ownership of discovery, permission, and readiness. |

This is a common lifecycle policy, not a requirement for identical page shapes or
persistent caches for all data. Each page's initial geometry follows its own
content. Unknown counts, paths, or metrics are not reported as successful values.

## Activity and Workbench

`EnvPageLoading` is the only built-in module-presentation registry. Its type must
cover every `BuiltinActivityPage`, so adding a built-in page requires an explicit
initial presentation and reload policy. Workbench lazy bodies use a local
Suspense boundary with the corresponding registry entry. A delayed Files, Terminal,
Monitoring, Codespaces, Web Services, Host Applications, or Containers widget
cannot suspend the entire canvas. Instance-specific Files sidebar width and
Containers resource view are passed to that same entry.

Workbench's initial layout read uses the shared neutral status. It does not add a
second animated curtain or advance through multiple loading designs before the
canvas is available. Existing canvas retention and connection recovery follow
[Workbench surface lifecycle](workbench-surface-lifecycle.md).

[Document reload presentation](document-reload-presentation.md) owns the single
pre-module geometry handoff. Eligibility comes from the same registry. It does
not persist terminal content, monitoring samples, configuration, plugin content,
or file names. [Resource snapshots](env-resource-cache.md) and
[filesystem navigation](filesystem-picker-navigation.md) own their respective
successful data and security boundaries.

# Boundaries

Loading stays inside the selected page or widget. It cannot replace an unrelated mounted page, the whole Workbench canvas or a successful retained result. Access denial and authentication changes take precedence; retained content does not grant permission.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPageLoading.tsx` - Exhaustive shared presentation registry.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Activity module and access-check entry.
- `redeven:internal/envapp/ui_src/src/ui/workbench/redevenWorkbenchWidgets.tsx` - Local widget loading boundaries.
- `redeven:internal/envapp/ui_src/src/ui/workbench/WorkbenchPageLoading.browser.test.tsx` - Seven delayed widget types preserve their surrounding canvas and draft node.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvTerminalPage.test.tsx` - Immediate catalog status without a blank interval or second curtain.
- `redeven:internal/envapp/ui_src/src/ui/widgets/RuntimeMonitorPanel.test.tsx` - One first-sample status and retained charts during refresh.
- `redeven:internal/envapp/ui_src/scripts/checkStartupContinuity.mjs` - Built-in navigation matrix and retained inventory refresh.
