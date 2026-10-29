---
type: UI Contract
title: Dialog content placement
tags: [ui, dialogs, accessibility, desktop]
lifecycle: contract
reviewed_at: "2026-10-29"
---
# Summary

Published Floe Webapp owns the shared Dialog structure. Redeven supplies localized
titles, body guidance, and actions. Headers contain identity and controls;
instructions and consequences belong in the body. This applies to ordinary
dialogs, confirmation dialogs, drawers, and window-local confirmations. A missing
or misplaced description is a content integration failure, never a reason to
restore a header subtitle or hide the text.

# Contract

Floe Webapp 0.84.0 removes the ambiguous `description` parameter from `Dialog` and `ConfirmDialog`. Custom headers and title JSX must not recreate the removed explanatory subtitle.

This contract changes no application connection, process, or window lifecycle.

## Header-safe bounds

Global dialogs and drawers reserve the visible application header before allocating
their body height. The shared Redeven stylesheet applies the larger of the native
Desktop titlebar and Floe's visible shell top bar plus its top safe inset, followed
by the published presentation gap. Floe owns the visible viewport, keyboard
response, remaining safe edges, panel maximum height, focus and dismissal. The
single product top-padding override is intentional because the published Dialog
sets that padding inline. Do not reintroduce per-dialog viewport subtraction or
minimum heights that can overflow short windows.

The shell header contract is Floe's `h-10` content plus its one-pixel border. A
headerless mobile shell adds no phantom header; inactive KeepAlive views do not
count as visible headers. Surface-local dialogs and Workbench window confirmations
stay within their existing host below the shell header without subtracting it a
second time. Side drawers keep their edge-attached presentation.

Headers, close controls and footer actions remain reachable while long content
scrolls inside the body. Flower settings, nested editors and conversation rename
use the published Dialog. Preserve the bounded loading geometry defined in
[page-loading continuity](page-loading-continuity.md).

# Boundaries

Headers contain identity and controls only. Missing guidance must be repaired in the body through the shared Dialog contract; a custom header, hidden description or restored subtitle is not a recovery path.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/primitives/EnvAppModal.tsx` - Uses the published Dialog and ConfirmDialog contracts.

- `redeven:internal/envapp/ui_src/src/ui/widgets/WindowModal.tsx` - Places window-local confirmation guidance in its scrollable body.

- `redeven:internal/envapp/ui_src/src/styles/dialogHeaderBounds.browser.test.tsx` - Real Floe shells and both host styles: global dialog/drawers, resizing, native titlebars, safe insets, hidden mobile headers and surface-local placement.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.settingsDialog.browser.test.tsx` - Settings and nested editors below actual shell headers at desktop/phone widths, with retained loading geometry.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.titleRename.browser.test.tsx` - Short-window bounds, title editing, saving and focus behavior.
