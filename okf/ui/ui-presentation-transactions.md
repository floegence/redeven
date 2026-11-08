---
type: UI Contract
title: UI presentation transactions
tags: [ui, interaction, performance, keep-alive]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Navigation selects synchronously, paints intent, commits target visibility, then focuses/resizes/scrolls/measures after content paint. Floe owns visual/committed value separation; Redeven applies it across heavy product surfaces without duplicating business state.

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

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:2405` - Source.
