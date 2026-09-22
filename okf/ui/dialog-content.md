---
type: UI Contract
title: Dialog content placement
description: Keep dialog titles distinct from visible body guidance across Env App, Desktop, drawers, and window-local confirmations.
tags: [ui, dialogs, accessibility, desktop]
timestamp: 2026-09-22T00:00:00Z
---
# Summary

Published Floe Webapp owns the shared Dialog structure. Redeven supplies localized
titles, body guidance, and actions. Headers contain identity and controls;
instructions and consequences belong in the body. This applies to ordinary
dialogs, confirmation dialogs, drawers, and window-local confirmations. A missing
or misplaced description is a content integration failure, never a reason to
restore a header subtitle or hide the text.

# Contract

Floe Webapp 0.64.0 removes the ambiguous `description` parameter from `Dialog` and
`ConfirmDialog`. Plain-text guidance uses `bodyDescription`, which renders once
at the start of the body and supplies the dialog's `aria-describedby` association.
Rich content uses children in the content viewport. Custom headers and title JSX
must not recreate the removed explanatory subtitle. WindowModal follows the same
product content contract while retaining its existing window-local ownership.

Description-only confirmations contain a populated body between the title and
actions. In particular, Stop sharing explains that the Mac application's windows
and unsaved work remain on the host; Cancel never invokes detach or quit.

Body layout customizations must include the description in their available space.
Drawers reserve remaining height for their content after guidance; terminal,
preview, and Git panels use explicit content classes rather than child-position
selectors. Guidance retains readable padding and wraps on narrow screens. Actions
remain reachable while long content scrolls. Existing localization keys retain
their meaning and text.

[Floating layer order](env-app-floating-layer-order.md) remains authoritative for
placement, focus, dismissal, and Workbench boundaries. This contract changes no
application connection, process, or window lifecycle.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/primitives/EnvAppModal.tsx` - Uses the published Dialog and ConfirmDialog contracts.
- `redeven:internal/envapp/ui_src/src/ui/primitives/EnvAppDrawer.tsx` - Allocates body guidance and remaining drawer content height.
- `redeven:internal/envapp/ui_src/src/ui/widgets/WindowModal.tsx` - Places window-local confirmation guidance in its scrollable body.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvHostApplicationsPage.browser.test.tsx` - Checks English and Simplified Chinese stop-sharing placement, narrow screens, and cancellation.
- `redeven:desktop/scripts/check-environment-settings.mjs` - Verifies Desktop settings guidance and interaction geometry.
