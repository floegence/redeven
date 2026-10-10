---
type: Qualification Record
title: Orange AFBC capture qualification
description: Verify the bounded legacy Rockchip scanout import repair and distinguish native qualification from deployed Viewer acceptance.
tags: [desktop, drm, rockchip, qualification]
timestamp: 2026-10-10T13:00:00Z
---
# Summary

The native converter owns physical scanout format normalization; Redeven
consumes its release without a second capture implementation. Orange's active
1920x1080 Wayland scanout is decodable through its installed EGL stack once
the exact legacy AFBC component convention is respected. Real pixel and native
lock/unlock tests pass on orange; udesk26 passes the corresponding regression.
Input authority remains with the privileged service and a fresh painted
generation. Native results do not qualify browser/network latency, physical
photons or an installed product update. Unsupported layouts fail explicitly.

# Contract

The [media contract](../architecture/remote-desktop-media.md) owns the format
mapping and privilege boundaries. The
[SSH deployment contract](../architecture/remote-desktop-ssh-deployment.md)
requires Env App scope confirmation and temporary administrator credentials for
permanent updates. Qualification uses isolated root-owned fixtures, not manual
replacement of installed components. No target Portal interaction, new driver,
compositor configuration, ACL change or private desktop is needed.

# Diagnosis

Orange runs a physical Wayland session on HDMI-A-2. Its single-plane XR24
framebuffer has pitch 7680, offset 0 and AFBC modifier
`0x0800000000000051`. The old import returns `EGL_BAD_MATCH` on both installed
Mesa/Panfork and Mali. This established an import mismatch, not an inability of
the hardware to decode its own scanout.

Inspection of the installed Panfork source revision
`120202c675749c5ef81ae4c8cdc30019b4de08f4` explains the mismatch: canonical
RGBA8 AFBC retains the BGR render-target swizzle; consumer modifier validation
rejects XR24 without a distinct private native-swizzle flag. Independent
unprivileged AB24 imports through both drivers succeed with the original FD,
modifier, offset and pitch. Their readbacks are identical, with red and blue
exchanged and green/layout intact. Explicit color fixtures verify the required
normalization direction. RGA was investigated and rejected after decoder faults;
it is not part of the repair.

The existing converter performs one import using a local descriptor copy. Only
the exact qualified Rockchip/SDR/single-plane layout is normalized. A valid
linear XR24 result is labeled XB24 so the existing FramePool/Pixman conversion
restores BGRx. There is no added per-pixel loop, trial-and-error import sequence,
backend or permission owner. Other layouts and actual negative conversion
errors retain their previous behavior. Unit tests exclude other drivers,
modifiers, private swizzle, HDR, AR24 and multiplane inputs.

# Native Physical-Host Qualification

The upstream change is commit
`2bcd721e2eeb68947c3943627ab0135068f2b808`, tagged `v0.22.34`.
The arm64 converter SHA-256 is
`8ef67eaee77276be7889ab4453242ac647158e870312eb15211b21bc2e6c5376`.
Architecture-specific workers were rebuilt against pinned libdrmtap
`95d4d74549631aa5c39461300acfd2e106583cc9` with verified builder identities.

Real tests use `/var/lib/redeven-orange-afbc-qualification`, task-only service
sockets and the existing published service executable. The unprivileged worker
uses the installed media closure. The installed systemd units and Runtime
identity records are unchanged by these tests.

| Test | orange | udesk26 |
| --- | --- | --- |
| DRM capture | 1920x1080; RGB bars, eight exact colors, one-pixel edges, 196608 checker pixels and visible text | 1920x1280 regression |
| Media | H.264 followed by PNG refinement | H.264 followed by PNG refinement |
| Native attachment | Fresh frame admission, generation and teardown pass | Same assertions pass |
| Real lock/unlock | Wake display, capture lock pixels, reject ordinary input and wrong password, accept correct physical password | Same assertions pass |
| Successor authority | Retired generation and unpainted successor rejected; new paint restores control | Same assertions pass |
| Client text delivery | ASCII, Chinese, emoji and following Enter match the GTK document | Same exact document assertion passes |
| Invalid DMA descriptor | 100 memfd requests preserve `EINVAL`; FD count stays stable; disconnect exits converter | Same assertions pass |

Known-pattern rows avoid an unrelated GNOME notification. Exact color and edge
assertions remain unchanged. No credentials are retained in the fixture,
service protocol, arguments, environment or maintained record.

# Measurements And Acceptance Limits

Three candidate-only rounds each use 100 alternating pointer moves, maximum
dimension 1920, 15 FPS and original pixels. A private-socket client measures
command receipt and a separate DRM observer measures matching cursor feedback.
These exclude SSH, browser presentation and actual screen light.

Values are empirical P95 milliseconds per round.

| Host | Command receipt | Matched DRM feedback |
| --- | --- | --- |
| orange | 7.882 / 8.449 / 11.023 | 17.031 / 17.169 / 17.431 |
| udesk26 | 8.140 / 9.771 / 9.887 | 16.822 / 16.786 / 66.872 |

The 100 ms DRM-feedback P95 target passes these rounds. Orange's third receipt
round exceeds 10 ms. udesk26 has individual feedback outliers of 782.9 and
915.2 ms; P95 alone does not certify a consistently smooth interaction.
Static service-and-worker CPU is approximately 37.7 / 38.0 / 42.8% of one core
on orange and 19.6 / 16.0 / 19.4% on udesk26 over five-second samples
(`USER_HZ=100`). No successful same-configuration orange AFBC baseline exists.
These data do not establish a 70% CPU reduction or all latency targets.

Env App deployment, complete Viewer acceptance, final installed closure
identities and cleanup must be recorded after their actual execution. The
[earlier responsiveness record](remote-desktop-responsive-input-results.md)
owns previous X11/client-input evidence and does not qualify this repair's
complete product flow.

# Evidence

- Published native `native/host-desktop/drm/worker.c` and `scanout_format.h`: single bounded import and existing output ownership.
- Published native `scanout_format_test.c` and `host_desktop_drm_native_test.py`: excluded layouts, real errno and FD cleanup.
- Published native `qualification/host_desktop_afbc_pattern.py` and `hostdesktop/login_capture_linux_test.go`: exact real-frame assertions.
- Published native `login_service_linux_test.go`, `login_unlock_qualification_linux_test.go` and `login_latency_qualification_linux_test.go`: authority and separate host measurement endpoints.
- [Producer component swizzle](https://github.com/ROCKNIX/mesa-panfork/blob/120202c675749c5ef81ae4c8cdc30019b4de08f4/src/panfrost/lib/pan_cs.c#L386).
- [Producer modifier validation](https://github.com/ROCKNIX/mesa-panfork/blob/120202c675749c5ef81ae4c8cdc30019b4de08f4/src/gallium/drivers/panfrost/pan_screen.c#L631).
- [Release qualification](https://github.com/floegence/floe-native-apps/actions/runs/38052107066).
