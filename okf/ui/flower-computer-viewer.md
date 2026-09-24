---
type: Architecture Contract
title: Flower computer viewer presentation
description: Present decoded computer frames with shared window geometry, accessible status and explicit recovery.
tags: [ui, flower, computer-use, media]
timestamp: 2026-09-24T00:00:00Z
---
# Summary

Published Floe owns Stage window geometry and launcher interaction; Flower owns
canonical visual status and presentation scope. Users can view decoded pixels,
move or restore the Stage, and retain geometry across visibility changes. Opening
and closing affect viewing only, never target or execution authority. Missing,
interrupted or private frames retain explicit recovery and cannot borrow an
unrelated public image. Media authorization and sampling remain with the
[Computer use media contract](../ai/computer-use-media.md).

# Contract

The Stage uses the published Floe `FloatingWindow` for its title bar, drag,
resize, maximize, and close controls. Flower supplies its entire surface as the
window boundary, including the conversation rail, header and composer. Live and
historical viewers can move across that surface; maximization fills it with a
12px inset. Floe owns clamping and projected Workbench coordinates. The header
uses `Link` for browser and desktop connection management and `MonitorPointer`
for viewing, with distinct localized accessible labels. The Stage body contains
decoded pixels only. Screenshots use the entire content box with proportional,
centered fit; non-live notices never share or reduce the image's horizontal space.
The footer places a quiet clock notice beside explicit Fit to window and Actual
size choices, with the active choice exposed visually and through `aria-pressed`.
On narrow windows the footer wraps without covering or cropping pixels.
Before the first decoded frame, the viewer centers an open capture-line
illustration, one localized status, and a short loading hint on a quiet theme
surface. The illustration uses bare strokes instead of an icon inside a tile.
Only an active connection or decode opts the scan line and status into the
published surface and text shimmer. Assistance, absent captures, and interrupted
viewing remain static. Small viewer heights reduce the artwork and then omit
the secondary hint. Empty
viewers have no footer. An interrupted empty view exposes one labeled retry or
reconnect button; a retained image keeps the existing header recovery action.
Decoded pixels replace the placeholder without changing window geometry.
Closing a live viewer switches to a 40px launcher with the published 20px
`MonitorPointer` icon, an opaque theme surface, thin border, and a restrained
black shadow. While the exact task is running, the header entry and visible
launcher use semantic blue with the published Floe progress shimmer. The header
has one label: execution mode when known, otherwise task status; assistance names
the step needing attention. It never prefixes that status with another Computer
label. Historical entries retain their View last screenshot action and expose
the matching task outcome in their tooltip and accessible name.
Waiting, takeover, paused, disconnected and settled states remove the shimmer;
non-running launchers remain neutral. Hidden launchers do not animate. Reduced
motion and forced colors use the upstream static presentation. There is no halo,
status ring or internal dot. Coarse pointers retain an invisible 48px hit area,
separate from the shimmer paint. Waiting and failure text uses muted semantic
colors. The accepted canonical current supplies exact turn/run outcome in the existing
`ThreadCache` detail. Only matching screenshot identity can show completed,
stopped or failed; a successful screenshot never proves task success. A later
text turn does not lend its outcome to an old frame. Without matching facts the
viewer shows only historical identity, with no inferred result. Floret
`view_version` is process-local: a workspace disconnect invalidates cached
version comparisons while retaining presentation. Reconnection rereads canonical
current; late HTTP results from the previous connection cannot replace it.
Private recovery waits for this refreshed detail.

Floe `SurfaceFloatingPanel` owns launcher placement, drag/click separation,
keyboard movement, edge snapping and projected boundaries. Flower supplies the
transcript as its safe boundary, excluding the header and dynamic composer.
The launcher snaps to four edges with a 12px inset and gentle motion, respecting
reduced motion. Click, Enter or Space restores viewing; arrows move it. Dragging
never restores viewing or sends remote input. Hidden launchers do not accept
pointer interaction or keyboard navigation. Published Floe owns gesture
cancellation, focus, geometry, snapping and animation details.

Stage displays a loading indicator only while an actual viewer subscription or
frame decode is pending. The existing ten-second viewer watchdog bounds first-frame
and stream failures. Without a subscription and screenshot it shows an explicit
empty state; a classified safety stop instead names the required assistance and
clears public pixels. A retained public frame is scoped to the same Thread, Run
and target and marked non-live during ordinary waiting. Private interaction changes
clear pixels and never fall back to a public keyframe. Target and source facts in
Activity identify the actual browser; previews do not require extra model screenshots.

Both components remain mounted across visibility changes, preserving the
window's position, size, and maximization and the launcher's relative placement.
Floe keeps preferred geometry separate from viewport constraints, so narrowing
does not permanently reduce the saved window size. Composer growth adjusts only
the launcher's safe boundary. Below a 560px Flower surface boundary the viewer
fills the safe region and hides desktop drag,
resize and maximize controls. Narrow transcripts reserve a launcher gutter.
Thread selection resets presentation and clears old pixels. The viewer starts
closed; a frame or semantic target Activity enables its entry. Activity, the header Computer entry,
and the launcher can restore it; close returns focus to the restoring entry.
Terminal execution stops sampling and collapses the viewer. Historical viewing
has no FPS, input carrier or launcher, and retains zoom, close, keyboard and
window geometry controls. Reopening resolves a durable public screenshot.
The viewer defaults to fit-to-window and offers scrollable actual-size pixels
outside user takeover. Fit responds to resize, maximization and projected
Workbench placement. Takeover retains its existing image coordinate, native IME, paste and
remote scroll semantics and keeps fit mode.
Closing removes private input controls and retires the viewing subscription,
without pausing execution, relinquishing user control, or recreating a target.
Later actions cannot reopen an explicitly hidden viewer.

# Boundaries

The viewer cannot authorize actions or own execution lifecycle. Historical
presentation starts no sampler or input carrier, and private interaction cannot
fall back to public pixels. Published Floe remains the only geometry, focus and
gesture owner; product status comes from matching canonical thread/run facts.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/FlowerComputerStage.window.browser.test.tsx` - real published Floe window and launcher interaction, geometry retention, status, and safe boundaries.
- `redeven:internal/flower_ui/src/FlowerComputerStage.tsx` - decoded Blob URL viewing.
