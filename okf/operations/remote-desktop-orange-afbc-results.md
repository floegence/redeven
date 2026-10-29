---
type: Qualification Record
title: Orange AFBC capture qualification
tags: [desktop, drm, rockchip, qualification]
lifecycle: active_evidence
reviewed_at: "2026-10-25"
---
# Summary

Published native conversion decodes Orange 1920x1080 Wayland scanout through installed EGL using the exact legacy AFBC convention. Real pixel/lock/unlock tests pass on Orange, with udesk26 regression. Privileged service/fresh paint owns input. Unsupported layouts fail; native results do not certify browser/network latency, physical photons or installed product update.

# Contract

The [media contract](../architecture/remote-desktop-media.md) owns the format mapping and privilege boundaries. No target Portal interaction, new driver, compositor configuration, ACL change or private desktop is needed.

# Boundaries

## Measurements And Acceptance Limits
Three candidate-only rounds each use 100 alternating pointer moves, maximum dimension 1920, 15 FPS and original pixels.

| Host | Command receipt | Matched DRM feedback |
| --- | --- | --- |
| orange | 7.882 / 8.449 / 11.023 | 17.031 / 17.169 / 17.431 |
| udesk26 | 8.140 / 9.771 / 9.887 | 16.822 / 16.786 / 66.872 |

## Deployed Viewer boundary
The [physical-device Viewer record](remote-desktop-device-viewer-results.md) owns the 2026-10-11 Env App deployment, actual toolkit input, physical unlock, window switching and bounded recovery measurements.

The [earlier responsiveness record](remote-desktop-responsive-input-results.md) owns previous X11/client-input evidence and does not qualify this repair's orange product flow.

# Evidence

- Published native `native/host-desktop/drm/worker.c` and `scanout_format.h`: single bounded import and existing output ownership.

- Published native `scanout_format_test.c` and `host_desktop_drm_native_test.py`: excluded layouts, real errno and FD cleanup.

- Published native `qualification/host_desktop_afbc_pattern.py` and `hostdesktop/login_capture_linux_test.go`: exact real-frame assertions.

Orange runs a physical Wayland session on HDMI-A-2. Unit tests exclude other drivers, modifiers, private swizzle, HDR, AR24 and multiplane inputs.

The upstream change is commit `2bcd721e2eeb68947c3943627ab0135068f2b808`, tagged `v0.22.34`. No credentials are retained in the fixture, service protocol, arguments, environment or maintained record.
