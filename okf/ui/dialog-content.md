---
type: UI Contract
title: Dialog content placement
description: Keep dialog titles distinct from visible body guidance across Env App, Desktop, drawers, and window-local confirmations.
tags: [ui, dialogs, accessibility, desktop]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
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

# Boundaries

Headers contain identity and controls only. Missing guidance must be repaired in the body through the shared Dialog contract; a custom header, hidden description or restored subtitle is not a recovery path.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/primitives/EnvAppModal.tsx` - Uses the published Dialog and ConfirmDialog contracts.

- `redeven:internal/envapp/ui_src/src/ui/primitives/EnvAppDrawer.tsx` - Allocates body guidance and remaining drawer content height.

- `redeven:internal/envapp/ui_src/src/ui/widgets/WindowModal.tsx` - Places window-local confirmation guidance in its scrollable body.
