---
type: Media Contract
title: Computer use media and visual requests
description: Resolve authenticated keyframes and bounded live samples into decoded Flower pixels without persisting image bytes in model history.
tags: [ai, computer-use, media, attachments]
timestamp: 2026-10-08T00:00:00Z
---
# Summary

Redeven owns screenshot bytes and authorized media resolution; Floret owns opaque
attachment history and provider rendering. Flower displays saved screenshots inline and offers decoded pixels in a
media-only Stage. Durable keyframes and ephemeral viewing samples have distinct
lifetimes. A missing, changed or unauthorized reference fails explicitly and
cannot fall back to an unrestricted image URL. Successful tool metadata alone
does not prove the user can see a frame.

Durable keyframes share one byte store and canonical retention entry point with
[direct image reads](image-read-and-retention.md). Existing `computer://`
references and their physical root remain unchanged. The media resolver owns
membership authorization without a preceding product detail load.

# Contract

Safe results return target identity, execution location, summary and safety.
Semantic observations and script operations omit images unless explicitly
requested. Visual primitives and screenshots return checked after-frame
attachments. Descriptors contain an opaque `computer://` reference, MIME, byte
size and SHA-256. Providers resolve bytes at request time; durable state stores
descriptors and hashes, never base64. Resolution failure, changed bytes and
unsupported model image capabilities fail explicitly.

[Flower computer viewer presentation](../ui/flower-computer-viewer.md) owns Stage geometry, launcher interaction, responsive layout and visual status. Media authority, sampling and durable references remain here.

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

Screenshot identity uses Floret v7.26.0's `ActivityPresentation.target_refs`: `kind: computer_frame`, opaque `resource_ref: computer://<target>/<sha256>`, and target display label. Navigable `uri` is not a media reference. The renderer stays `structured` without custom frame fields. Public projection preserves hash-addressed frame references, bounded Computer target identities, and validated requested-access facts. Other opaque references remain private. A target reference enables semantic-only viewing; it does not grant site, application or media authority. Env App and Desktop Welcome resolve frames through the authenticated thread media endpoint into short-lived Blob URLs. Desktop's authorized Runtime IPC carries PNG `Uint8Array` bytes; credentials stay in main. Image sources cannot use opaque references directly or bypass authorization through an HTTP fallback.

Dedicated `computer.screenshot` success requires one fully validated PNG for
the exact executed target, saved before returning its attachment. Missing,
corrupt, mismatched or unsaved pixels fail explicitly. Adapter buffers are always
released. Post-action save failures retain confirmed execution and never turn
into a request for human inspection.

A valid saved screenshot reference makes its Activity default open. Disclosure
uses `manualOpen ?? defaultOpen`; updates never override a manual collapse.
Choices stay local to the activity during the mounted UI session; reload restores
the default. Completed turns containing a saved screenshot default collapsed
through the existing turn disclosure store. The automatically open image preview
does not count as deliberate inspection; focus, selection and manual expansion
retain the existing reading protection. Reopening the turn preserves the inner
Activity disclosure and image retry controls.
Other tools stay collapsed and may show attached images on expansion.
Computer and browser screenshots in expanded Activity details use a compact
thumbnail, bounded to 20rem wide with a 16:9 viewport and contain sizing. They
omit the media canvas background, dot pattern, inset padding and separate
preview toolbar. Clicking the thumbnail opens the saved image for inspection;
loading, failure and retry retain the same bounded space. Collapsed Activity
details unmount the thumbnail. Ordinary assistant media keeps its presentation.
The published Floe `MarkdownMedia` owns proportional image display, enlargement,
cancellation and retry. Retry rereads only the original saved image, never runs
a screenshot tool. Resolution is bound to the owning Thread and resource, and
switching conversations cancels pending work. A missing image shows a localized
load failure. No title, target summary or generic result is repeated as detail.

Historical saved frames use the same inline path, including older Chrome captures.
A record without an image explains that no screenshot was saved; it does not
borrow a newer frame, capture again or expose private viewer pixels. The tool's
own outcome remains independent of any subsequent pending question. The header
viewer continues to offer the latest saved capture for an observed target even
when a newer semantic observation has no image. Historical viewing starts no
live sampler or input carrier.

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


- `redeven:internal/ai/computer_live_frames.go` - bounded observer-owned samples.
- `redeven:internal/ai/computer_media.go` - host keyframe storage and validation.
- `redeven:internal/flower_ui/host/computerFramePath.ts` - host-owned media route encoding without transport or authorization.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.computerLifecycle.browser.test.tsx` - history, canonical result identity and interrupted recovery.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.computerStage.browser.test.tsx` - distinct header actions, full-surface window movement, live-to-durable transition and reopening.
- `redeven:scripts/check_computer_use_webtop.sh` - container-only real Linux Flower qualification and cleanup.
- `redeven:internal/ai/floret_provider_prepared_test.go` - visual budgeting and prepared request identity.
