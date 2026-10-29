---
type: UI Contract
title: UI presentation transactions
tags: [ui, interaction, performance, keep-alive]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Heavy navigation acknowledges selection synchronously, commits target visibility after that intent can paint, then performs focus, resize, scroll or measurement after content paint. Published Floe separates visual from committed values; Redeven applies this ordering across Activity, Workbench, terminal, Flower, Files/Git and heavy panels without duplicating business state.

# Contract

## Mechanism
Initialization, persisted restoration, permission correction, automatic open and recovery use synchronous canonical commitment such as `commitNow()`. Genuinely blocking operations keep their dedicated presentation.

## Activity and retained content
Activity uses Shell UI-first mode and after-paint activation. Files preserves hidden virtual-grid measurements, usable width/range/scroll. Flower keeps the previous transcript during cold selection and replaces it only when the latest destination is ready.

## Measurement
Debug Console groups presentation events by surface/source. User interactions must avoid renderer tasks/frame gaps of 50 ms or more. Instrumentation flags intent at 32 ms and content at 100 ms; focused performance/browser gates enforce distributions and long-task limits.

# Boundaries

UI-first scheduling is not permission to duplicate canonical state or create a second business model.

Explicit environment replacement, permission-root replacement, connection recovery, resource-pressure policy already owned by the relevant subsystem, and user-requested closure may establish separate lifecycle boundaries; a navigation click alone may not.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:2405` - Activity/Workbench display mode uses a shared UI-first selection controller.

- `redeven:internal/envapp/ui_src/src/ui/widgets/RemoteFileBrowser.tsx:3246` - Files and Git retain mounted panels after first activation.
