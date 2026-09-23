---
type: UI Contract
title: Whole-window status surfaces
description: Present environment recovery, access gates, and standalone Desktop availability without applying glass to movable content.
tags: [ui, desktop, accessibility, workbench]
timestamp: 2026-09-22T00:00:00Z
---
# Summary

Floe owns the shared whole-window layout, static artwork, retry geometry and progress shimmer. Redeven maps real connection, access and Desktop states to those published primitives. Glass is permitted only on a fixed host-window layer above a retained, inert workspace. Access gates and standalone documents use an opaque neutral theme background. Floating windows, Workbench widgets and draggable content never receive this material. Failure retains the existing recovery owner and explicit actions; appearance never grants access or starts another recovery loop.

# Contract

## Placement and state ownership

Environment recovery mounts outside the Workbench canvas and its transformed widgets. The underlying workspace remains inert while covered. The access gate exposes no protected workspace pixels and keeps password focus, autocomplete, validation, retry throttling, language selection and session recovery under EnvAppShell ownership. Its view is a product adapter with explicit access-state inputs; it does not acquire credentials or reconnect transports.

Desktop CodeSpace loading and failure are local scriptless documents. Env App remains responsible for starting the editor and prompting for an ephemeral password. A failure directs the user back to Codespaces for a complete retry; the status document cannot bypass that flow or gain privileged preload access. Native window lifecycle and route ownership remain defined by [Native Desktop CodeSpace access](../desktop/codespace-native-access.md).

Web Service and standalone application failure documents send a reserved `https://redeven.invalid/window-status/retry` intent. The native controller accepts it only from the exact current failure document, prevents any network navigation to that intent, and temporarily applies working-state CSS to the trusted document before reconnecting. Working feedback remains visible until the service replaces that document; navigation discards the document-local stylesheet. A cancelled retry removes its feedback. This avoids renderer-to-data navigation and keeps the document scriptless. The controller guards duplicate requests while working; replacement, navigation and window closure cancel the pending retry. Application documents omit service addresses and developer checks. Web Service documents retain the requested address and place diagnostic guidance in collapsed details. Status styling is never injected into third-party application documents.

## Visual and accessibility behavior

Use the published `window-status.css` slots and browser-neutral `window-status` artwork entry. Desktop maps the selected published Floe semantic tokens into its CSP-restricted document and inlines the published `progress-shimmer.css`; it does not copy platform CSS or SVG geometry. Static retry arrows share Floe's Refresh geometry.

Only active working text receives `data-floe-progress-shimmer="text"`. There is no spinning progress icon or animated progress line on these surfaces. Countdown, paused and terminal states do not shimmer. Published shimmer supports reduced motion and forced colors; long translated copy and technical details must remain readable without horizontal scrolling. Diagnostic content is collapsed initially. Existing live-region, focus and form relationships remain available.

Access-gate language menus use the shared floating layer and clamp to the visible viewport or projected Workbench boundary, including short mobile viewports and safe-area offsets. Menu rows remain at least 44px and Escape or outside input restores focus to the trigger.

Generic loading curtains, dialogs and local Workbench error boundaries retain their existing material. A whole-window layout must not become a shared fallback for components that can be moved onto a canvas.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/reconnect/ConnectionRecoveryView.tsx` — Host recovery placement and real retry/stop actions.
- `redeven:internal/envapp/ui_src/src/ui/EnvironmentAccessGate.tsx` — Product access-state presentation.
- `redeven:internal/envapp/ui_src/src/ui/EnvironmentAccessGate.browser.test.tsx` — Locale, geometry, opaque backdrop and keyboard form acceptance.
- `redeven:desktop/src/main/windowStatusDocument.ts` — Published assets and selected theme adapter.
- `redeven:desktop/src/main/webServiceUnavailableDocument.ts` — Scriptless availability and retry presentation.
- `redeven:desktop/src/main/codespaceLoadingDocument.ts` — Scriptless editor loading and failure presentation.
- `redeven:desktop/scripts/check-window-status-electron.mjs` — Isolated native Electron document and actual retry acceptance, included in the full Desktop check.
