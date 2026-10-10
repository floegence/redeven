---
type: Qualification Record
title: Physical desktop responsiveness and local input
description: Assess physical-seat input and DRM capture on orange and udesk26, distinguishing host feedback from client presentation.
tags: [desktop, input, drm, latency, qualification]
timestamp: 2026-10-10T11:33:00Z
---
# Summary

Native v0.22.33 provides idle capture wakeup; published Floe controllers own
bounded pointer submission and local text mode. The
[media contract](../architecture/remote-desktop-media.md) owns privileged
authority; the [viewer contract](../architecture/remote-desktop-viewer.md) owns
input modes. Locks remain physical-only; generation and mode changes revoke
input. This record qualifies document contents, DRM feedback and encoded-frame
arrival separately. The supported udesk26 path passes functional qualification. Orange's current
Wayland scanout cannot be imported by either installed EGL driver. Its functional
and latency qualification remains incomplete; this record does not claim that
all performance targets passed.

# Contract

## Diagnosis and changes

Released `text_input` separates local composition from clipboard synchronization.
Native v0.22.33 wakes idle capture on interaction; published pointer input keeps
one latest move and flushes it before other events. Existing native/viewer owners
retain authorization, release and ordering. The production CSP now permits cursor
image decoding. RustDesk/Sunshine informed comparison; no code was copied.

Orange's original X11 measurements used one active HDMI output. After reboot,
both outputs were connected and the desktop used Wayland. The earlier results do
not qualify that new setup; no permanent display policy was changed.

## Native input comparison

Each of three rounds uses 100 pointer moves at 1920 maximum dimension, 15 FPS
and original pixels. udesk26 is amd64/1920x1280; orange is arm64/1920x1080.
Version-matched clients and a separate DRM cursor observer use a local private
socket, excluding network and browser work. Both versions use current protocol.

Values are milliseconds, empirical P95 in each of three rounds.

| Host and version | Input receipt | Matching DRM feedback |
| --- | --- | --- |
| udesk26 v0.22.32 | 3.699 / 4.194 / 3.696 | 17.659 / 17.692 / 18.118 |
| udesk26 v0.22.33 | 7.655 / 7.191 / 10.015 | 16.946 / 17.094 / 17.039 |
| orange v0.22.32 | 5.060 / 6.750 / 5.678 | 5.498 / 6.523 / 6.035 |
| orange v0.22.33 | 11.566 / 12.063 / 14.842 | 8.907 / 7.869 / 11.809 |

DRM P95 is below 100 ms; input receipt P95 exceeds 10 ms in some rounds.
The separate [v0.22.29 comparison](remote-desktop-latency-results.md) owns its
CPU evidence. Neither endpoint measures browser paint or physical scanout.

## Physical-host qualification

Both hosts previously passed native attachment, current-frame admission,
retired-generation rejection, teardown, ASCII/Chinese/emoji text and Enter.
Native GNOME-locker tests captured locked pixels, rejected ordinary input and
invalid physical credentials, accepted the correct credentials and required a
successor painted generation before restoring control.

The udesk26 Desktop SSH Viewer passed local text, drag/down-up, wheel, keyboard,
view-only cursor, lock, cancel, input fencing and invalid/valid physical unlock.
It also passed explicit disconnect/reconnect, service stop/start, Runtime
termination and Desktop SSH restart, and explicit takeover. The old Viewer
became view-only with its keyboard disabled. Service loss erased the picture and
revoked input. Runtime identity replacement requires opening a new session.
Credentials were absent from arguments, environment and diagnostics.

After orange's operator reboot, Desktop SSH automatically started the task
Runtime on port 24247. Env App updated the current service and Runtime identity.
An initial SSH stdout half-close reproduced Node `ERR_INTERNAL_ASSERTION` during
HTTP/2 stream teardown. The fix closes composed stdio before HTTP/2 and lets
connection destruction own stream cleanup. The deterministic active-stream test
failed before the fix; the subsequent real Env App update succeeded.

Orange now uses Wayland. Its exporter passes one DMA-BUF successfully, but the
UID-1000 converter returns `-ENOTSUP`. Independent GBM probes initialize both
installed Mesa and Mali EGL drivers; both reject the actual XR24 scanout modifier
`0x800000000000051` with `EGL_BAD_MATCH`. Neither advertises that modifier. This
establishes the current driver/scanout boundary, not permanent hardware
impossibility. No drivers, compositor policy, Portal approval or private desktop
were changed. Env App shows this precise reason in its current step and offers
Refresh. Connect appears only after capability becomes available. Orange's
post-reboot input, lock/unlock and latency remain unqualified; earlier X11
measurements apply only to that setup.

After a physical monitor was attached, a fresh SSH probe confirmed an active
1920x1080 Wayland CRTC on HDMI-A-2; its XR24 framebuffer still uses modifier
`0x800000000000051`. The root exporter transferred its DMA-BUF, while the
UID-1000 Mesa/Rockchip converter returned `-ENOTSUP` and EGL import returned
`EGL_BAD_MATCH`. A separate UID-1000 probe imported the same buffer through the
host's installed RGA library, but RGA3 and RGA2 submission both failed with
`Invalid argument`; the kernel logged `invalid function policy`. Thus the
connected display fixes the inactive-output condition but does not make this
scanout convertible. No full desktop frame or input session could be qualified
on orange in this configuration. No display content was retained by the RGA
probe.

The stalled-ticket/control fixture fails before the Viewer timeout fix and
passes afterward. Initial connection and frame recovery share a ten-second
picture deadline, with disabled input, erased pixels and reachable Reconnect /
Disconnect. Explicit OS authorization retains its user-driven lifecycle.

## Client and idle CPU observations

Real CUA drags with one controlling udesk26 Viewer produced cursor-feedback P95
44.0 / 41.2 / 47.6 ms, with only 6 / 8 / 6 matched observations. Matching used a
2.5% coordinate tolerance, so these are exploratory samples rather than formal
strict-position acceptance. Two Viewers produced P95 57.2 / 233.6 / 459.7 ms;
the comparison does not isolate CPU, media transport or network contention.
Mac-to-host RTT ranged 4.856–125.675 ms in thirty pings. Input-result timing is
excluded because the Runtime assigns native command IDs independently; naïve
client-ID correlation is not authoritative.

Static installed-service CPU, including all exporter, media, converter and text
children, was 13.58% / 14.78% / 10.99% of one core in three five-second rounds
with one Viewer and a stable process set. No same-configuration baseline was
captured in that round, so this does not establish a 70% reduction.

## Idle desktop response

At 60 FPS/original pixels, a GTK fixture toggles black/white on Space. Three
rounds each use twelve samples after 850 ms idle. Ordered H.264 decoding
verifies center pixels. The endpoint is matching encoded-packet arrival,
excluding network/browser presentation. Temporary orange decoders were removed.

Values are median / P95 milliseconds per round.

| Host and version | Round 1 | Round 2 | Round 3 |
| --- | --- | --- | --- |
| udesk26 v0.22.32 | 86.283 / 193.823 | 76.856 / 192.253 | 73.528 / 98.269 |
| udesk26 v0.22.33 | 73.765 / 94.790 | 62.772 / 84.435 | 50.607 / 89.433 |
| orange v0.22.32 | 241.530 / 267.476 | 255.642 / 282.653 | 246.081 / 257.422 |
| orange v0.22.33 | 96.195 / 265.283 | 100.704 / 274.402 | 103.856 / 224.087 |

Orange's median improves 58–61%, but its first input retains a slow tail.
An independent trace locates a 157.13 ms first KMS switch, capture at 180.81 ms
and H.264 at 211.98 ms, despite GTK pixels changing within 31 ms. Later switches
take 10.25–22.91 ms. Two individual real Viewer canvas samples take 172.3 and
175.3 ms after the host event. These expose remaining host/capture/client work,
without isolating compositor/driver cause or measuring P95 or physical photons.

## Lock input and regression boundaries

Released `physical-only` mode fixes orange's earlier lock-screen IME leak.
It disables the editor and sends hardware key codes
from the non-editable surface. Chromium/WebKit/Firefox upstream tests cover IME,
empty codes, stale composition and release without weakening ordinary text
input. udesk26 verified physical unlock; orange still needs the post-reboot
invalid/valid unlock round once capture is supported.

# Boundaries

The candidate consumes public native v0.22.33 and web v0.86.19 and preserves
current local-main changes. Registry metadata, immutable package bytes and
clean-consumer checks passed. `GOWORK=off` Go/race/vet, X11/Wayland/macOS and
Electron fixtures, panel/localization and UI/Desktop checks cover the affected
contracts. The CSP cursor-decode test failed before its fix and passed afterward.
Native and web release qualifications passed; links are in Evidence.

Task ports are local 24236, udesk26 24246 and orange 24247; task Runtimes never
bind 23998. Env App owns SSH scope confirmation and temporary administrator
credentials. Target Portal approval is not a prerequisite.
No credentials enter Runtime/service protocols or this record.

The installed root services are active/enabled, with closures:

- udesk26: `b911a4635c831014bcd02f9d72517f9c7c7318e6d2dab3311d36c1701947a0f5`;
- orange: `51ac0a9d4bc0bcd4d464c1bf8de3e217284786d17f5d768f7abf1f600e42ecbe`.

Runtime hashes were admitted through Env App's update transaction. Host receipts,
DRM metadata and encoded packets do not measure physical photons. The 70% static
CPU reduction, input-processing P95 and stable orange client latency targets
remain unqualified. Full physical-host acceptance is incomplete.

# Evidence

- Published native `host_desktop_drm.py`, `hostdesktop/login_service_linux.go`
  and `login_seat_linux.go`: wakeup and physical-seat authority.
- Published native `login_latency_qualification_linux_test.go`,
  `login_text_qualification_linux_test.go` and
  `login_unlock_qualification_linux_test.go`: host measurements and assertions.
- Published web `createRemotePointer` and `createRemoteInput`: bounded motion,
  physical/text modes and focus modifier preservation.
- `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs`: production CSP,
  cursor decoding, input modes, paint authority and browser/Electron recovery.
- [Web release qualification](https://github.com/floegence/floe-webapp/actions/runs/38037697008).
- [Native release qualification](https://github.com/floegence/floe-native-apps/actions/runs/37976652415).
- [RustDesk source](https://github.com/rustdesk/rustdesk/blob/001b0e96173cea4e49f9f7a67bea95a177dd1de3/src/platform/linux.rs)
  and [Sunshine source](https://github.com/LizardByte/Sunshine/blob/899095522a9ed50bb511d6f1fd103b8ad716d527/src/input.cpp).

Raw host logs and test material remain outside maintained source. They contain
neither passwords nor diagnostic input contents.
