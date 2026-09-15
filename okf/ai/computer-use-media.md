---
type: Media Contract
title: Computer use media and visual requests
description: Resolve authenticated keyframes and bounded live samples into decoded Flower pixels without persisting image bytes in model history.
tags: [ai, computer-use, media, attachments]
timestamp: 2026-09-15T00:00:00Z
---
# Summary

Redeven owns screenshot bytes and authorized media resolution; Floret owns opaque
attachment history and provider rendering. Flower displays decoded pixels in a
media-only Stage. Durable keyframes and ephemeral viewing samples have distinct
lifetimes. A missing, changed or unauthorized reference fails explicitly and
cannot fall back to an unrestricted image URL. Successful tool metadata alone
does not prove the user can see a frame.

# Contract

Each safe completed action returns target ID, target display name, execution location, an action summary, a safety decision, and an after-frame attachment. Attachment descriptors contain an opaque `computer://` resource reference, MIME, byte size, and SHA-256. Provider renderers resolve bytes only at request time; durable state stores descriptor and hash, never base64. A resolver error, unknown reference, changed bytes, or unsupported model capability is an explicit error.

Flower publishes target actions on its existing workspace stream as ordinary tool Activity. The activity renderer shows target, action, execution location, approval state, and the latest screenshot attachment. Structured target errors include the target kind, readiness state, and a repair action so the UI can explain setup, permission, connection, and takeover recovery instead of asking the user to guess a target. Live frames are target-scoped ephemeral media and do not create a second lifecycle stream or polling loop.

The floating Stage is a media-only viewer: it displays the latest action screenshot and a close icon, without internal state labels or explanatory text. It opens when an Activity contains a frame reference, not for an empty tool-start payload. Closing only hides it; thread selection resets its presentation state. A viewer may start only when the frame Activity belongs to the currently active
canonical run. Historical pixels remain visible during preparation but cannot
start capture; the first current-run frame activates viewing without retries.
After the first successful action, Runtime may publish target-scoped live frame metadata at approximately 3 FPS through the existing workspace stream. Each workspace subscriber retains at most one pending media descriptor (maximum 4 KiB), replacing stale media without consuming lifecycle queue capacity. Lifecycle delivery has priority. Viewer closure cancels queued capture immediately; an admitted passive capture
drains within five seconds so hiding the image does not destroy a healthy
browser session. Late pixels are discarded. Action cancellation retains its
existing adapter interruption boundary. The sampler stop waits for capture to exit, and an old stop cannot cancel a replacement session. The viewer requests capture through its authenticated workspace observer and the thread media endpoint can resolve that active session's bounded samples. Completion, viewer hiding, thread or target changes, and disconnect retire live samples in the UI; the viewer then resolves the durable action keyframe. Reopening must never prefer a retired live reference over that keyframe. Continuous viewing and sensitive-page suspension still require their complete product qualification; decoded action frames alone do not prove continuous-view support.

Screenshot identity crosses Floret v7.12.0's published `ActivityPresentation.target_refs` boundary as `kind: computer_frame`, with a `computer://<target>/<sha256>` opaque `resource_ref` and target display label. Navigable `uri` is not the media contract. The renderer remains `structured`; custom frame fields do not belong to its closed payload. Redeven's public timeline sanitizer preserves only hash-addressed computer frame references under that kind. Both Env App and Desktop Welcome resolve the same reference through the authenticated thread media endpoint into a short-lived Blob URL. Desktop uses its existing authorized Runtime IPC request channel to carry PNG bytes as `Uint8Array`; runtime credentials stay in main. No opaque reference is assigned directly to an image source, and no HTTP image fallback bypasses this boundary.

Live capture requires the target's currently active thread lease at sampler
startup and before every observation. A historical keyframe permits reading
that image only; it cannot acquire an idle shared target or revive a released
lease. Private handback may restore control only through the canonical pending
interaction described by the takeover contract.

Only typed executor attachments create model image references or Activity media capabilities. Arbitrary `computer://` strings in result payloads do not grant image authority. Runtime drops unsafe attachments and releases adapter buffers before storage or ordinary live viewing. Explicit private user viewing follows the [takeover contract](computer-use-takeover.md) and never uses the durable image resolver.

Tool-result images must survive Floret's model request snapshots and the Redeven provider adapter: nested Floret tool attachments are resolved, checked against model capabilities, and mapped back into `ToolResult.Attachments` before the published DeepSeek renderer emits `function_call_output` image parts. A model receiving only a textual screenshot reference does not qualify as visual execution. The Settings switch removes typed computer/browser functions from newly prepared tool registries when disabled.

DeepSeek Vision Experimental is qualified through typed function tools only. Requests use `deepseek-v4-flash-vision-exp`, include screenshot input and `function_call_output` image parts, and never register the native `computer_use` tool.

DeepSeek budget admission and streaming use the same prepared request from
published Floret v7.12.0. Visual input uses the upstream image token bound;
base64 transport bytes are not counted as ordinary text. The Redeven adapter
maps product data and preserves admission, cancellation, and event semantics;
it does not independently estimate the DeepSeek intermediate DTO. Large images,
tool results, and replay must retain their exact transmitted bytes.

Built Desktop qualification listens read-only to the existing preload workspace
stream; Linux Webtop uses CDP's passive copy of the existing HTTP workspace
stream. Both run the same Composer scenarios and hash decoded Stage Blob bytes.
They require matching thread, target
and image hash across multiple live events in each turn, not just tool keyframes
or a successful first turn. Animated fixture markers prove pixels continue to
change without requiring additional model actions. Observation
stops before private takeover; no image bytes or private input enter this report.
A missing native or browser live-frame match fails its explicit scope.

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
are excluded from this binary-only fixture environment.
Its scope includes managed-browser actions, X11 GUI control effects, per-turn
decoded live frames, hidden-viewer persistence, settings and login handback with
rapid ASCII and native Chromium IME submission. It does not qualify native
macOS, connected Chrome, every OS input method, or every sensitive-page and approval scenario.

# Evidence

- `redeven:internal/ai/computer_live_frames.go` - bounded observer-owned samples.
- `redeven:internal/ai/computer_media.go` - host keyframe storage and validation.
- `redeven:internal/flower_ui/src/FlowerComputerStage.tsx` - decoded Blob URL viewing.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.computerStage.browser.test.tsx` - live-to-durable transition and reopening.
- `redeven:scripts/check_computer_use_webtop.sh` - container-only real Linux Flower qualification and cleanup.
- `redeven:internal/ai/floret_provider_prepared_test.go` - visual budgeting and prepared request identity.
