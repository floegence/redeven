---
type: UI Contract
title: Floating Files window dismissal
description: Close the floating Files window without a blank exit frame while preserving responsive cleanup and reopen behavior.
tags: [ui, files, floating-windows, lifecycle, motion]
timestamp: 2026-10-16T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The Files surface controller owns whether a request is active and returns focus
immediately when it closes. The floating window host retains the last request's
title, persistence key, and live browser content while the published Floe
FloatingWindow completes exit presence. This prevents a blank frame without
starting another timer, copying rendered content, or keeping a second browser
mounted. Floe marks the exiting window inert and retires it at the end of its
motion, including reduced-motion behavior; a new request cancels that pending
exit through the same window lifecycle.

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

- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserSurfaceHost.tsx` - Retains the last presentation for the existing window exit lifecycle.

- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserSurfaceHost.browser.test.tsx` - Checks frame-by-frame content continuity, inert exit, cleanup, reduced motion, themes, and rapid reopen.
