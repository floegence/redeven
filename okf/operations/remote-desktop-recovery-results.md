---
type: Acceptance Record
title: Desktop reconnect qualification results
description: Verify published desktop transport, locked reconnect, physical Mac hotplug and Wayland display recovery with fresh-paint authority.
tags: [desktop, validation, lifecycle, audio]
timestamp: 2026-10-02T15:30:00Z
---
# Summary

Published `floe-native-apps` v0.22.7 passes Linux X11 and macOS product reconnect:
the running audio device survives replacement, new samples reach its AudioWorklet,
and input waits for current paint. Mac physical hotplug, locked replacement and
Wayland mode changes also pass fresh-paint recovery. These results do not certify
[Wayland performance](remote-desktop-wayland-results.md); `udesk24` is designated
for functional validation only. The [session contract](../architecture/remote-desktop.md)
owns normative behavior; the [overall record](remote-desktop-results.md) owns
performance and delivery boundaries.

# Contract

Published product qualification uses clean Redeven source `69cd04988970`.

## Deterministic Regression

The previous viewer closed its player on transport loss while retaining an
enabled sound preference. Reconnection reused that closed player, so the sound
toggle could remain enabled without a live output device. A browser regression
failed against the previous source and passed after reconnect switched to
`reset(0)` and preserved one player per viewer window. Explicit user disconnect
still closes the output device.

The extended check creates real encoded Opus packets with AudioEncoder and
requires new-generation decoded samples at the production AudioWorklet after
transport replacement. It verifies the retained running AudioContext and
enabled sound setting, then checks that explicit disconnect closes the context.
Both host-platform browser variants and Electron 41.10.5 passed. This controlled
codec check is separate from the real-host evidence below.

## Real X11 Product Reconnect

The task Runtime on `server` used source `cb2fd0c6c`, published native v0.22.6,
native Floeterm, `GOWORK=off` and no dependency overrides. The binary SHA-256 was
`2b17636e9a8143520127b3a8bd50bb19174f106007a2e2067039d4de09b620f2`.
Tests used the actual authenticated product viewer over its task SSH forward,
with a task-owned GTK fixture and remote system-output tone.

Each size passed Chinese/emoji explicit paste, pointer targeting, drag selection,
scrolling, bidirectional text clipboard, full screen, view-only and control
takeover. The original-pixel refinement matched the independent lossless
reference. Closing the active control socket replaced both control and media
attachments. The same AudioContext remained `running`, and a second remote tone
delivered fresh samples and nonzero energy to the production worklet. At most
one worklet handoff was pending, with zero at the sampled completion.

| Capture | Input samples | Input-to-painted-response P95 | Reconnect sound |
| --- | --- | --- | --- |
| 1920x1080 | 100 | 66.5ms | Fresh samples, retained running output |
| 2560x1440 | 100 | 67.6ms | Fresh samples, retained running output |

No page, protocol or request error occurred. Input timing uses DOM keydown,
the host's changed marker and the player's post-render receipt; it excludes
physical scanning and display scanout. The original performance matrices were
not repeated in this regression. The 1440p display lease restored the host's
original 1920x1080@60 setting, confirmed by `xrandr`. This new run has no additional
human listening claim; physical Linux-to-Mac playback is separately confirmed
in the Wayland record.

## Real macOS Product Reconnect

Clean Redeven source `07337d30981561ffd9b72ecfdb5c80b68af67dae` contains the
same product fix and an evidence-only follow-up. Its native-Floeterm build uses
published native v0.22.6 with SHA-256
`16893767aa11a06ceec9a8539640d23875ee2ffc02293b044cc46c5791d8c972`.
The helper retained its previously qualified published Swift build.

The actual product's 2560x1440 office flow passed Chinese/emoji paste, pointer,
drag, scrolling, bidirectional clipboard, full screen, view-only and takeover.
Original-pixel mode captured 4608x2592; its 800x120 text-region refinement matched
the independent ScreenCaptureKit screenshot. The same running AudioContext
survived transport replacement and received a second system-output tone through
the production worklet. At most two handoffs were pending, with zero at the
sampled completion. Client volume remained zero to prevent same-host feedback;
this is decoded-sample evidence, not physical listening.

After returning to 2560x1440, 100 input samples measured P95 68.4ms using the
same DOM-to-post-render boundary. No page, protocol or failed-request error
occurred. The fixture's frontmost ownership was checked before every input;
the task fixture exited normally. This regression did not repeat the full
performance matrix or certify physical hotplug.

## Published v0.22.7 Qualification

Upstream commit `29ed2f3f71b429f18cbea19811522931ce97cf0c` has an immutable
v0.22.7 tag. Its Release qualification run `37016208383` and final Release gate
passed, and the GitHub release was published on 2026-10-02 at 15:10:02 UTC.
The official Go proxy and checksum database returned the tagged source and
module checksum `h1:MJLggW9f34s8gDXhleRxlSWYr24YAQ3aMxHKEE4mBcI=`.
Redeven's Go and exact Swift pins reference this release. Formal builds use
`GOWORK=off` and no overrides. The Linux binary SHA-256 is
`113b03dc17bbcd5c3ca6b4e2389016289a35fda172af446cac40c48baa789cca`;
the Mac binary SHA-256 is
`c364c60f2476836c0390e520f0f33cb5c8b02dfd2a7f74eeb8b855a535f94f86`.
The Mac helper resolves the exact official Swift package. Both browser variants,
Electron 41.10.5, desktop/appserver race tests, vet, module verification, 32 Swift
tests and the helper release build pass against the published dependency.

The final 2560x1440 product runs on `server` and macOS pass office interactions,
three decoder recoveries, original-pixel reference equality and sound continuity
after actual control-transport replacement. Their 100-input DOM-to-post-render
P95 values are 68.2ms and 69.3ms. Runtime restart invalidates old sessions and
media tickets with HTTP 404, preserves host fixture text, waits for fresh paint
and replays no input. Neither run records page, protocol or failed-request errors.
The X11 display lease restores 1920x1080@60. Full performance matrices retain
their v0.22.6 provenance; this lifecycle change does not alter capture cadence.

The user-confirmed Mac physical unplug/replug passes on v0.22.7. The stable
display catalog does not change, but recovery is observable through socket and
generation transitions: socket 1/generation 3 connecting, replacement socket
3/generation 1 locked, then generation 2 connecting and active. The replacement
requires its own fresh paint before input; no input is injected and no authority
violation occurs. Catalog identity alone is not the hotplug recovery oracle.

A separate product test locks the Mac, closes its control attachment and creates
a replacement while locked. During a two-second quiet period it has no media,
paint or input. Normal local unlock advances that replacement from generation
1 to 2; new H.264 and paint precede input enablement. A late locked-generation
receipt is ignored by the product without reconnecting or granting authority.
This does not claim remote unlock. Native direct calls reject stale receipts
with `STALE_DESKTOP`; the product's pre-dispatch ignore has the same authority
boundary but a different observable response.

On `udesk24`, actual supported 2560x1440 -> 1920x1080 -> 2560x1440 changes
produce `DISPLAY_STREAM_LOST`, replace the transport, restore the authorized
RemoteDesktop portal attachment and require new paint. Both transitions preserve
the fixture with zero injected input or authority violations. This is mode-change
evidence, not physical Linux monitor hotplug. The original 1440p mode is restored.

# Boundaries

## Earlier Native Candidate Evidence

A real Wayland native candidate recognized Mutter's retired PipeWire node after
a supported mode change as `DISPLAY_STREAM_LOST`. It retired held input and old
frame authority, reconnected the authorized portal, produced a fresh 1280x800
frame after the initial 1920x1080 frame, and rejected stale-generation input.
No input was injected. This is native candidate evidence, not a published
product recovery result or physical monitor removal.

A real macOS native candidate created a new connection while the authorized
desktop was locked. It produced zero locked video frames, injected no input,
and resumed generation 2 with fresh H.264 only after the user's normal local
unlock. An old paint receipt returned `STALE_DESKTOP`. It does not qualify remote
unlock. Its direct native behavior remains separate from the product tests above.

# Evidence

Private task records are under `task-evidence/remote-desktop-20261001/`:

- `viewer-reconnect-audio-red.log`: deterministic previous-source failure.
- `viewer-reconnect-audio-sample-green.log`, `viewer-reconnect-linux-audio-sample-green.log` and `viewer-reconnect-electron-audio-sample-green.log`: controlled browser/Electron codec regressions.
- `server-product-reconnect-regression-v0226.json`: exact build identity, both actual capture sizes, sound readback and input measurements.
- `server-v0226-audio-reconnect-product.log` and `server-v0226-audio-reconnect-product-1440.log`: office, reference, reconnect and cleanup observations.
- `macos-v0226-audio-reconnect-product.log` and `macos-deployment-v0.22.6-07337d309815.json`: exact Mac build, retained output context, reference equality and input results.
- `udesk24-candidate-display-recovery.log` and `macos-candidate-lock-recovery.json`: native candidates and their limits.
- `server-v0227-published-product.log` and `macos-v0227-published-product.log`: final published office, media, transport and Runtime-restart results.
- `hotplug-macos-v0227-published-hotplug.json`: confirmed physical action and socket/generation paint gating.
- `macos-locked-reconnect-v0227-published-locked-reconnect.json`: paused replacement, local unlock and stale-receipt boundary.
- `udesk24-v0227-published-mode-restoration-display-recovery.json`: both actual mode transitions and restored original mode.
- `native-v0227-attempt3-summary.json` and the individual `native-v0227-*-attempt*.log` files: retained release failures; earlier graphical failures remain unattributed, while later fixed-snapshot downloads recorded closed connections or HTTP errors.
