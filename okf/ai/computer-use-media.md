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

Desktop qualification observes the preload workspace stream; Linux Webtop uses
CDP's passive HTTP workspace stream copy. Both run the same Composer scenarios
and hash decoded Stage Blob bytes, requiring matching thread, target and image
hash across multiple live events in every turn. Animated fixture markers prove
pixels change without more model actions. Observation stops before private
takeover; reports exclude image bytes and private input. A missing native or
browser live-frame match fails that scope.

`scripts/check_computer_use_webtop.sh` is an opt-in Linux browser and X11 UI
qualification entrypoint. It requires the local DeepSeek configuration and an
explicit verified Linux plugin runtime artifact directory. It builds with
`GOWORK=off`, stages the production browser bundle in Debian Webtop, imports
the isolated Runtime CA into the container browser, and drives Flower through
visible navigation and Composer controls. Runtime sockets and credentials live
in the container filesystem. The desktop, browser, fixtures, and all input stay
inside the task-owned container; cleanup removes that container, temporary
bundles, and credential copies and verifies source secrets and port release.
Cleanup waits for exact container-ID absence because Docker stop and removal
acknowledgements can precede automatic deletion. Inventory failure or timeout
fails the run. The report retains the Runtime, computer bundle, and plugin
verification descriptor hashes after temporary binaries are removed.
An optional `REDEVEN_NODE_ARCHIVE` reuses a downloaded Linux archive; it must
match the current `.node-version`, architecture, and official SHA-256 before
execution. Network downloads are bounded and unused source-package indexes
are excluded from this binary-only fixture environment. Setup has a ten-minute
deadline. An explicit `REDEVEN_COMPUTER_WEBTOP_DEBIAN_MIRROR` may select an HTTPS
Debian mirror origin; it is recorded in the manifest and retains APT signature
verification. There is no automatic mirror fallback. Unused Docker and
NodeSource repositories from the base image do not participate in setup.
Its scope includes managed-browser actions, X11 GUI control effects, per-turn
decoded live frames, hidden-viewer persistence, settings and login handback with
rapid ASCII and native Chromium IME submission. It does not qualify native
macOS, connected Chrome, every OS input method, or every sensitive-page and approval scenario.
The shared UI runner also stops canonical takeover and an outstanding browser
navigation through Flower's Stop button. Ordinary cancellation requires no
appended Stop message or error card. Dispatched navigation instead requires
`floret_effect_outcome_unknown`, a visible safety warning and no replay action;
the fixture must receive exactly one navigation. Both retain the cancellation
fact, restore the composer and allow an explicit visual follow-up in the same
thread. `REDEVEN_COMPUTER_UI_SCENARIO=lifecycle` runs only this focused UI scope
and records it separately; it cannot qualify the complete browser/X11 matrix.
The Linux fixture publishes its observable JSON state atomically so readers
never accept or skip a partial write. The held navigation fixture makes
the interruption observable without injecting model calls or bypassing the
production adapter. Each scenario records its own result; an earlier passing
browser turn cannot substitute for a failed cancellation or follow-up.

The Linux runner additionally checks isolation and recovery through Composer,
the visible Fork menu and public media APIs. An unrelated thread must receive
404 for the parent's keyframe and show no stale Stage. A fork must inherit the
authorized keyframe and support a new visual task. A verified container Runtime
PID is gracefully restarted against the same state; media hashes, decoded Blob
pixels and cross-thread rejection must survive, followed by a real browser
turn. No test reads Floret-owned storage. `REDEVEN_COMPUTER_UI_SCENARIO=recovery`
runs this focused scope, and the complete Linux suite includes it. Replacement
Runtime shutdown and container cleanup remain mandatory on failure as well as
success.

After cleanup the runner writes `acceptance-summary.json`. Scope, frozen commit,
artifact hashes, real provider/image evidence, required scenario results and
cleanup must all match before that scope passes. A focused report cannot satisfy
the complete Linux matrix. Missing evidence, provider rejection, retained
programs or ports, and private-data exposure fail closed even if earlier UI
steps succeeded. The summary names the other product scopes it does not qualify.
The observing proxy drains response streams through an awaited pipeline. An
upstream disconnect propagates to Flower and records a sanitized interruption;
it must not crash the harness before thread evidence is captured. Downstream
user cancellation closes the upstream body without pretending the provider
failed. HTTP 200 alone does not prove a completed stream, and the proxy never
replays a request to turn transport failure into success.

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
