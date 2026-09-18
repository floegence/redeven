---
type: Media Contract
title: Computer use media and visual requests
description: Resolve authenticated keyframes and bounded live samples into decoded Flower pixels without persisting image bytes in model history.
tags: [ai, computer-use, media, attachments]
timestamp: 2026-09-17T00:00:00Z
---
# Summary

Redeven owns screenshot bytes and authorized media resolution; Floret owns opaque
attachment history and provider rendering. Flower displays decoded pixels in a
media-only Stage. Durable keyframes and ephemeral viewing samples have distinct
lifetimes. A missing, changed or unauthorized reference fails explicitly and
cannot fall back to an unrestricted image URL. Successful tool metadata alone
does not prove the user can see a frame.

# Contract

Safe results return target identity, execution location, summary and safety.
Semantic observations and script operations omit images unless explicitly
requested. Visual primitives and screenshots return checked after-frame
attachments. Descriptors contain an opaque `computer://` reference, MIME, byte
size and SHA-256. Providers resolve bytes at request time; durable state stores
descriptors and hashes, never base64. Resolution failure, changed bytes and
unsupported model image capabilities fail explicitly.

The Stage uses the published Floe `FloatingWindow` for its title bar, drag,
resize, maximize, and close controls. Its body contains decoded pixels only.
Closing a live viewer switches to a neutral 40px launcher with the published 20px
`MonitorPointer` icon, an opaque theme surface, thin border, and a restrained
black shadow. It has no glow, status ring or internal dot. Coarse pointers gain
an invisible 48px hit area. Running, waiting, completed, stopped and failed states appear as
localized text in the header and viewer; waiting and failure use muted semantic
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
Floe keeps preferred geometry separate from viewport constraints, so composer
growth and narrowing do not permanently reduce the saved window size. Below a
560px content boundary the viewer fills the safe region and hides desktop drag,
resize and maximize controls. Narrow transcripts reserve a launcher gutter.
Thread selection resets presentation and clears old pixels. The viewer starts
closed; a frame or semantic target Activity enables its entry. Activity, the header Computer entry,
and the launcher can restore it; close returns focus to the restoring entry.
Terminal execution stops sampling and collapses the viewer. Historical viewing
has no FPS, input carrier or launcher, and retains zoom, close, keyboard and
window geometry controls. Reopening resolves a durable public screenshot.
The viewer offers fit-to-window and scrollable actual-size pixels outside user
takeover. Takeover retains its existing image coordinate, native IME, paste and
remote scroll semantics and keeps fit mode.
Closing removes private input controls and retires the viewing subscription,
without pausing execution, relinquishing user control, or recreating a target.
Later actions cannot reopen an explicitly hidden viewer.

A viewer may start only when its frame or semantic `computer_target` Activity
belongs to the active canonical RunID and TurnID. A semantic target reference
authorizes current-run viewing under the existing active target lease; it is not
a durable image capability. Historical pixels remain readable but cannot start
capture or acquire target control. Explicitly opening the current target starts
viewing without manufacturing a model screenshot.
After the first successful action, Runtime publishes live metadata through the
existing workspace stream. The header offers 3, 5, 10, 15 and 30 FPS (default 3),
using existing client storage in Env App and Desktop Welcome. One setting applies
to every thread and both ordinary and private viewing. This is a sampling ceiling;
the header explains bandwidth cost and shows actual reception rate in its detail.
The native selector supports keyboard input without dragging the window.

A preview failure belongs to its thread, run and target. A later run needs its
own target observation before opening a fresh sampler. Releasing run ownership
cancels matching samplers before making the target idle; sampler startup
rechecks active ownership before registration.

One target gate serializes input, safety observation and sampling. Input has
priority; busy ticks are skipped. Samplers retain at most two frames and await
the current frame read before capturing again. Each workspace subscriber keeps
one replaceable descriptor (maximum 4 KiB); lifecycle delivery has priority.
One decode job and one latest pending frame prevent backlog. Pixels replace the
last decoded image only after decoding. Failure or ten seconds without frames
marks viewing paused and offers explicit recovery.

Closing cancels queued capture; an admitted passive capture drains within five
seconds without destroying a healthy browser. Sampler stop waits for capture,
without letting an old stop cancel its replacement. Action cancellation keeps
its adapter interruption boundary. Hiding, target/thread change, terminal state
and disconnect retire live samples; late pixels are rejected. Explicit history
resolves the durable keyframe, never a retired live reference. Private disconnect
retains the last decoded pixels and requires the observer-bound recovery in the
[takeover contract](computer-use-takeover.md). Both kinds of viewing share the
sampler, authenticated workspace channel and decoding path.

Screenshot identity uses Floret v7.12.0's `ActivityPresentation.target_refs`: `kind: computer_frame`, opaque `resource_ref: computer://<target>/<sha256>`, and target display label. Navigable `uri` is not a media reference. The renderer stays `structured` without custom frame fields. Public projection preserves hash-addressed frame references, bounded Computer target identities, and validated requested-access facts. Other opaque references remain private. A target reference enables semantic-only viewing; it does not grant site, application or media authority. Env App and Desktop Welcome resolve frames through the authenticated thread media endpoint into short-lived Blob URLs. Desktop's authorized Runtime IPC carries PNG `Uint8Array` bytes; credentials stay in main. Image sources cannot use opaque references directly or bypass authorization through an HTTP fallback.

Opening a screenshot from Activity selects that canonical frame, including when
newer semantic observations have no image. Historical viewing starts no live
sampler and retains the chosen frame across minimize/restore. The selection is
local presentation state scoped to the thread and current run; a new run, thread
change, explicit live-view request or private takeover releases it.
Without an explicit selection, completed viewing resolves the last saved capture
of the latest observed run and target. An image-free observation must not hide
that capture's viewer entry.

When a turn completes or fails, an already open public viewer retains its last
decoded live pixels while sampling stops, even when an older model screenshot
exists. Closing the viewer ends that preservation; reopening loads its durable
capture. Thread, target and privacy changes clear the decoded image. This does
not create a durable screenshot. Private takeover pixels are cleared on handback
and do not use this completion behavior.

Live capture requires the target's currently active thread lease at sampler
startup and before every observation. A historical keyframe permits reading
that image only; it cannot acquire an idle shared target or revive a released
lease. Private handback may restore control only through the canonical pending
interaction described by the takeover contract.

Only typed executor attachments create model image references or Activity media capabilities. Arbitrary `computer://` strings in result payloads do not grant image authority. Runtime drops unsafe attachments and releases adapter buffers before storage or ordinary live viewing. Explicit private user viewing follows the [takeover contract](computer-use-takeover.md) and never uses the durable image resolver.

DeepSeek visual budgeting and streaming share Floret's prepared request and
image token bound. Redeven preserves those exact bytes and does not separately
estimate provider DTOs or treat base64 bytes as text.

Real product qualification, target scopes, evidence and cleanup requirements are
owned by [Computer use qualification](computer-use-qualification.md). Unit or
fixture results alone must not be presented as complete product qualification.

# Boundaries

The media viewer does not authorize target actions, own lifecycle state, or expose private takeover pixels to model history.

Runtime media route encoding belongs to the host adapters, outside the shared UI
source tree. Env App and Desktop share the pure path encoder; each host retains
its existing authenticated transport and byte validation.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/FlowerComputerStage.window.browser.test.tsx` - real published Floe window and launcher interaction, geometry retention, status, and safe boundaries.

- `redeven:internal/ai/computer_live_frames.go` - bounded observer-owned samples.
- `redeven:internal/ai/computer_media.go` - host keyframe storage and validation.
- `redeven:internal/flower_ui/src/FlowerComputerStage.tsx` - decoded Blob URL viewing.
- `redeven:internal/flower_ui/host/computerFramePath.ts` - host-owned media route encoding without transport or authorization.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.computerLifecycle.browser.test.tsx` - history, canonical result identity and interrupted recovery.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.computerStage.browser.test.tsx` - live-to-durable transition and reopening.
- `redeven:scripts/check_computer_use_webtop.sh` - container-only real Linux Flower qualification and cleanup.
- `redeven:internal/ai/floret_provider_prepared_test.go` - visual budgeting and prepared request identity.
