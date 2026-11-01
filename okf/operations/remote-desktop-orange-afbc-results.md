---
type: Qualification Record
title: Orange AFBC capture qualification
tags: [desktop, drm, rockchip, qualification]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

Native 0.22.34 decodes Orange 1920×1080 Wayland legacy AFBC through EGL. Real pixels/lock/unlock and udesk26 regression pass; unsupported layouts reject. Input still requires privileged service/fresh paint. Native checks do not certify product update, browser/network latency or physical photons.

# Contract

[Media](../architecture/remote-desktop-media.md) owns mapping/privilege. Commit 2bcd721e2eeb68947c3943627ab0135068f2b808 needs no Portal, driver, ACL or compositor change. Exclude other drivers/modifiers/HDR/multiplane.

# Boundaries

[Viewer](remote-desktop-device-viewer-results.md) owns product acceptance; [earlier response](remote-desktop-responsive-input-results.md) cannot certify this repair. Git retains three 100-move rounds and source evidence; credentials excluded.

# Evidence

- Published native `native/host-desktop/drm/worker.c` and `scanout_format.h`: single bounded import and existing output ownership.

- Published native `scanout_format_test.c` and `host_desktop_drm_native_test.py`: excluded layouts, real errno and FD cleanup.

- Published native `qualification/host_desktop_afbc_pattern.py` and `hostdesktop/login_capture_linux_test.go`: exact real-frame assertions.

Orange runs a physical Wayland session on HDMI-A-2. Unit tests exclude other drivers, modifiers, private swizzle, HDR, AR24 and multiplane inputs.

The upstream change is commit `2bcd721e2eeb68947c3943627ab0135068f2b808`, tagged `v0.22.34`. No credentials are retained in the fixture, service protocol, arguments, environment or maintained record.
