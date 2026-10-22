---
type: UI Contract
title: UI presentation transactions
description: Heavy selection changes present visual intent first, commit content after paint, and defer layout effects until content presentation.
tags: [ui, interaction, performance, keep-alive]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven prioritizes visible input acknowledgement over the secondary work caused by a selection change. A heavy navigation event is one presentation transaction with three ordered stages: the lightweight selected control is updated synchronously, target content visibility is committed after that intent can paint, and activation-dependent focus, controller resize, scroll restoration, viewport movement, or measurement runs only after the target content can paint. This ordering applies to Activity navigation, Activity/Workbench mode, terminal sessions, Workbench widgets, Flower threads, Files/Git modes, and heavy Settings, Plugin Center, or Debug Console panels.

# Contract

## Mechanism
The published floe-webapp controller exposes separate visual and committed values. Initialization, persisted restoration, permission correction, automatic open, and connection recovery use the synchronous canonical path such as `commitNow()` because they are not waiting to acknowledge a user input.

Operations that genuinely block the surface, such as resolving and opening a Web Service route, retain their dedicated blocking presentation.

## Activity and retained content
Activity uses the Shell UI-first mode and after-paint `ActivityAppsMain` activation.

Files use the published hidden-measurement preservation contract for grid/list virtualization and the product toolbar, so `display:none` cannot erase the last usable width, viewport range, or scroll position.

Flower keeps an old transcript visible while a cold target loads and atomically replaces it only when the latest target is ready.

## Measurement
Debug Console subscribes to the product presentation event stream and groups samples by `surface + source`. A user interaction must not produce a 50 ms or longer renderer task or frame gap. Debug instrumentation reports a slow presentation when intent reaches 32 ms or content reaches 100 ms; performance gates and browser tests provide the stricter distribution and long-task assertions.

# Boundaries

UI-first scheduling is not permission to duplicate canonical state or create a second business model.

Explicit environment replacement, permission-root replacement, connection recovery, resource-pressure policy already owned by the relevant subsystem, and user-requested closure may establish separate lifecycle boundaries; a navigation click alone may not.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:2405` - Activity/Workbench display mode uses a shared UI-first selection controller.

- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalPanel.tsx:1423` - Terminal selection separates visual state, committed session state, and deferred focus.

- `redeven:internal/envapp/ui_src/src/ui/widgets/RemoteFileBrowser.tsx:3246` - Files and Git retain mounted panels after first activation.
