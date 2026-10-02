---
type: Acceptance Record
title: Desktop reconnect qualification results
description: Verify retained sound and fresh-paint authority after transport replacement, and distinguish native recovery candidates from published product acceptance.
tags: [desktop, validation, lifecycle, audio]
timestamp: 2026-10-02T15:08:00Z
---
# Summary

The actual Linux X11 and macOS product viewers pass reconnect regression with
published `floe-native-apps` v0.22.6. Linux tested 1920x1080 and 2560x1440 with
clean source `cb2fd0c6c7d15d609426449f17df77998b1eaa23`; macOS tested the
1440p office workflow and original pixels with source `07337d309`. A transport replacement retains
the window's running audio device; fresh remote system-output samples reach its
production AudioWorklet, and input resumes after current paint. This closes the
tested sound-reconnect defect. It does not certify the unreleased v0.22.7 product,
physical display hotplug or the outstanding
[Wayland performance boundary](remote-desktop-wayland-results.md).
The [session contract](../architecture/remote-desktop.md) owns normative behavior;
the [overall record](remote-desktop-results.md) owns original performance and
local delivery.

# Deterministic Regression

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

# Real X11 Product Reconnect

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

# Real macOS Product Reconnect

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

# Native Recovery Candidate

Upstream commit `29ed2f3f71b429f18cbea19811522931ce97cf0c` has an immutable
v0.22.7 tag. Its GitHub release remains pending the owning Release gate. Passing
source, Swift or host-desktop media checks alone cannot authorize a downstream
dependency upgrade.

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
unlock or the still-pending product physical-hotplug check.

# Evidence

Private task records are under `task-evidence/remote-desktop-20261001/`:

- `viewer-reconnect-audio-red.log`: deterministic previous-source failure.
- `viewer-reconnect-audio-sample-green.log`, `viewer-reconnect-linux-audio-sample-green.log` and `viewer-reconnect-electron-audio-sample-green.log`: controlled browser/Electron codec regressions.
- `server-product-reconnect-regression-v0226.json`: exact build identity, both actual capture sizes, sound readback and input measurements.
- `server-v0226-audio-reconnect-product.log` and `server-v0226-audio-reconnect-product-1440.log`: office, reference, reconnect and cleanup observations.
- `macos-v0226-audio-reconnect-product.log` and `macos-deployment-v0.22.6-07337d309815.json`: exact Mac build, retained output context, reference equality and input results.
- `udesk24-candidate-display-recovery.log` and `macos-candidate-lock-recovery.json`: native candidates and their limits.
- `native-v0227-attempt3-summary.json` and the individual `native-v0227-*-attempt*.log` files: retained release failures; earlier graphical failures remain unattributed, while later fixed-snapshot downloads recorded closed connections or HTTP errors.
