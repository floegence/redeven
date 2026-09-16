---
type: Media Contract
title: Computer use media and visual requests
description: Resolve authenticated keyframes and bounded live samples into decoded Flower pixels without persisting image bytes in model history.
tags: [ai, computer-use, media, attachments]
timestamp: 2026-09-16T00:00:00Z
---
# Summary

Redeven owns screenshot bytes and authorized media resolution; Floret owns opaque
attachment history and provider rendering. Flower displays decoded pixels in a
media-only Stage. Durable keyframes and ephemeral viewing samples have distinct
lifetimes. A missing, changed or unauthorized reference fails explicitly and
cannot fall back to an unrestricted image URL. Successful tool metadata alone
does not prove the user can see a frame.

# Contract

Each safe completed action returns target ID and name, execution location, summary, safety decision, and an after-frame attachment. Descriptors contain an opaque `computer://` reference, MIME, byte size, and SHA-256. Providers resolve bytes at request time; durable state stores descriptor and hash, never base64. Resolution failure, unknown references, changed bytes, and unsupported model capabilities fail explicitly.

The Stage uses the published Floe `FloatingWindow` for its title bar, drag,
resize, maximize, and close controls. Its body contains decoded pixels only.
Closing switches to a neutral 40px launcher with the published 20px
`MonitorPointer` icon, an opaque theme surface, thin border, and a restrained
black shadow. It has no glow, status ring or internal dot. Coarse pointers gain
an invisible 48px hit area. Running, waiting, completion and failure appear as
localized text in the header and viewer; waiting and failure use muted semantic
colors. State belongs to the run that produced the displayed frame; a later text
turn cannot change historical Computer status, and a provider failure overrides
a successful screenshot from that run.

Floe `SurfaceFloatingPanel` owns launcher placement, pointer capture, drag/click
separation, keyboard movement, edge snapping, and projected-surface boundaries.
Flower supplies the actual transcript element as the safe boundary, excluding
the header and dynamic composer. A committed drag snaps to the nearest of four
edges with a 12px gap and a distance-sensitive 210–360ms gentle transition;
reduced motion completes immediately. The gray landing marker and release share
the same nearest-edge rule; only exact distance ties use the current gesture's
latest direction. Release coordinates are applied even without a final move;
lost capture retains document tracking. Browser cancellation, blur and missed
release settle at the last held point, while explicit Esc restores the starting
placement. Animation interruption freezes the visible position. Clicking, Enter, or Space restores the viewer; arrow keys move the
launcher. Dragging does not activate restoration or send remote input. Hidden
launchers are absent from pointer interaction and keyboard navigation.

Both components remain mounted across visibility changes, preserving the
window's position, size, and maximization and the launcher's relative placement.
Floe keeps preferred geometry separate from viewport constraints, so composer
growth and narrowing do not permanently reduce the saved window size. Below a
560px content boundary the viewer fills the safe region and hides desktop drag,
resize and maximize controls. Narrow transcripts reserve a launcher gutter.
Thread selection resets presentation and clears old pixels. The viewer appears
only after an Activity supplies a frame. Activity, the header Computer entry,
and the launcher can restore it; close returns focus to the restoring entry.
The viewer offers fit-to-window and scrollable actual-size pixels outside user
takeover. Takeover retains its existing image coordinate, native IME, paste and
remote scroll semantics and keeps fit mode.
Closing removes private input controls and retires the viewing subscription,
without pausing execution, relinquishing user control, or recreating a target.
Later actions cannot reopen an explicitly hidden viewer.

A viewer may start only when the frame Activity belongs to the currently active
canonical run. Historical pixels remain visible during preparation but cannot
start capture; the first current-run frame activates viewing without retries.
After the first successful action, Runtime publishes live metadata through the
existing workspace stream. The header offers 3, 5, 10, 15 and 30 FPS (default 3),
using existing client storage in Env App and Desktop Welcome. One setting applies
to every thread and both ordinary and private viewing. This is a sampling ceiling;
the header explains bandwidth cost and shows actual reception rate in its detail.
The native selector supports keyboard input without dragging the window.

One target gate serializes input, safety observation and sampling. Input takes
priority; busy sampling ticks are skipped. Each sampler retains at most two
frames and waits for the current frame read before generating another, so slow
clients cannot build a backlog or expire their unread frame. A single decode
job and latest pending frame replace pixels only after decoding. Interrupted
viewing retains the last image, displays a paused state and offers explicit
recovery. Ten seconds without frames also marks active viewing paused.
 Each workspace subscriber retains at most one pending media descriptor (maximum 4 KiB), replacing stale media without consuming lifecycle queue capacity. Lifecycle delivery has priority. Viewer closure cancels queued capture immediately; an admitted passive capture
drains within five seconds so hiding the image does not destroy a healthy
browser session. Late pixels are discarded. Action cancellation retains its
existing adapter interruption boundary. The sampler stop waits for capture to exit, and an old stop cannot cancel a replacement session. The viewer requests capture through its authenticated workspace observer and the thread media endpoint can resolve that active session's bounded samples. Completion, viewer hiding, thread or target changes, and disconnect retire live samples in the UI; the viewer then resolves the durable action keyframe. Reopening must never prefer a retired live reference over that keyframe. Private viewing uses the same scheduling and decoding path with the observer-bound authorization in the [takeover contract](computer-use-takeover.md).

Screenshot identity uses Floret v7.12.0's `ActivityPresentation.target_refs`: `kind: computer_frame`, opaque `resource_ref: computer://<target>/<sha256>`, and target display label. Navigable `uri` is not a media reference. The renderer stays `structured` without custom frame fields. The public timeline sanitizer preserves only hash-addressed references of this kind. Env App and Desktop Welcome resolve them through the authenticated thread media endpoint into short-lived Blob URLs. Desktop's authorized Runtime IPC carries PNG `Uint8Array` bytes; credentials stay in main. Image sources cannot use opaque references directly or bypass authorization through an HTTP fallback.

Live capture requires the target's currently active thread lease at sampler
startup and before every observation. A historical keyframe permits reading
that image only; it cannot acquire an idle shared target or revive a released
lease. Private handback may restore control only through the canonical pending
interaction described by the takeover contract.

Only typed executor attachments create model image references or Activity media capabilities. Arbitrary `computer://` strings in result payloads do not grant image authority. Runtime drops unsafe attachments and releases adapter buffers before storage or ordinary live viewing. Explicit private user viewing follows the [takeover contract](computer-use-takeover.md) and never uses the durable image resolver.

DeepSeek budget admission and streaming use the same prepared request from
published Floret v7.12.0. Visual input uses the upstream image token bound;
base64 transport bytes are not counted as ordinary text. The Redeven adapter
maps product data and preserves admission, cancellation, and event semantics;
it does not independently estimate the DeepSeek intermediate DTO. Large images,
tool results, and replay must retain their exact transmitted bytes.

Real product qualification, target scopes, evidence and cleanup requirements are
owned by [Computer use qualification](computer-use-qualification.md). Unit or
fixture results alone must not be presented as complete product qualification.

# Boundaries

The media viewer does not authorize target actions, own lifecycle state, or expose private takeover pixels to model history.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/FlowerComputerStage.window.browser.test.tsx` - real published Floe window and launcher interaction, geometry retention, status, and safe boundaries.

- `redeven:internal/ai/computer_live_frames.go` - bounded observer-owned samples.
- `redeven:internal/ai/computer_media.go` - host keyframe storage and validation.
- `redeven:internal/flower_ui/src/FlowerComputerStage.tsx` - decoded Blob URL viewing.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.computerStage.browser.test.tsx` - live-to-durable transition and reopening.
- `redeven:scripts/check_computer_use_webtop.sh` - container-only real Linux Flower qualification and cleanup.
- `redeven:internal/ai/floret_provider_prepared_test.go` - visual budgeting and prepared request identity.
