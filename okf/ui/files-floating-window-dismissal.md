---
type: UI Contract
title: Floating Files window dismissal
tags: [ui, files, floating-windows, lifecycle, motion]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Files controller owns active request and immediate return focus. Floating host retains title/key/live browser through Floe exit presence, with no extra timer/copied content/second browser. Floe makes exit inert and disposes after motion, including reduced motion. New requests cancel exit through that same lifecycle.

# Contract

## Close and reopen
Explicit close clears the controller request immediately so the browser is no longer active and focus restoration can proceed.

The same FloatingWindow owner cancels a pending exit; an earlier close completion must not retire the reopened surface.

Closing must not leave an independent timeout or detached browser alive after the window disappears.

## Responsiveness and resource lifetime
Closing must accept subsequent page actions without waiting for exit motion. The focused browser fixture exercises 1,000 directory entries and five cycles, checks synchronous close and frame intervals below 50ms, and verifies that controller close, opener focus, and an underlying action remain responsive.

# Boundaries

The controller remains the owner of active request state and return focus. The host contributes only a memoized last presentation; it does not duplicate the animation lifecycle, preserve a DOM snapshot, or add local polling.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/createFileBrowserSurfaceController.ts` - Clears the active request and restores the visible opener on close.

- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserSurfaceHost.browser.test.tsx` - Checks frame-by-frame content continuity, inert exit, cleanup, reduced motion, themes, and rapid reopen.
