---
type: Qualification Record
title: Physical desktop responsiveness and local input
tags: [desktop, input, drm, latency, qualification]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

Native v0.22.33 wakes idle capture; Floe owns bounded pointer/local text. Media/viewer contracts own authority/modes; locks are physical-only and generation/mode changes revoke input. Document contents, DRM feedback and encoded arrival are separate checks. udesk26 passes; Orange AFBC follow-up owns later repair. Native success is not complete Viewer/performance acceptance.

# Contract

Native v0.22.33 separates local composition from clipboard sync and wakes idle capture; no permanent display-policy change. Earlier evidence does not qualify new setup. Three rounds use 100 moves, max dimension 1920, 15 FPS/original pixels. Receipt / matching DRM feedback in ms:

| Host/version | Receipt rounds | DRM rounds |
| --- | --- | --- |
| udesk26 .32 | 3.699/4.194/3.696 | 17.659/17.692/18.118 |
| udesk26 .33 | 7.655/7.191/10.015 | 16.946/17.094/17.039 |
| Orange .32 | 5.060/6.750/5.678 | 5.498/6.523/6.035 |
| Orange .33 | 11.566/12.063/14.842 | 8.907/7.869/11.809 |

udesk26 is amd64/1920×1280; Orange arm64/1920×1080. Both earlier native lanes verify attachment, frame authority, stale rejection, teardown and ASCII/Chinese/emoji/Enter. Later pixels prove bounded AB24 component-order normalization. OS consent remains explicit.

One controlling udesk26 Viewer yields cursor-feedback P95 44.0/41.2/47.6 ms with only 6/8/6 matches. Independent Runtime command IDs prevent naïve client timing correlation. No matched baseline, hence no 70% reduction claim.

Idle Space-to-black/white GTK response at 60 FPS/original pixels, median/P95 ms per round:

| Host/version | Rounds |
| --- | --- |
| udesk26 .32 | 86.283/193.823; 76.856/192.253; 73.528/98.269 |
| udesk26 .33 | 73.765/94.790; 62.772/84.435; 50.607/89.433 |
| Orange .32 | 241.530/267.476; 255.642/282.653; 246.081/257.422 |
| Orange .33 | 96.195/265.283; 100.704/274.402; 103.856/224.087 |

physical-only fixes Orange lock IME leakage; Chromium/WebKit/Firefox cover empty codes/stale composition/release without weakening ordinary typing. udesk26 physical unlock passes. Orange invalid/valid unlock and new generation belong to AFBC evidence; full Desktop SSH Viewer acceptance is separate.

# Boundaries

The candidate consumes public native v0.22.33 and web v0.86.19 and preserves current local-main changes.

Task ports are local 24236, udesk26 24246 and orange 24247; task Runtimes never bind 23998.

Full physical-host acceptance is incomplete.

# Evidence

- Published native `host_desktop_drm.py`, `hostdesktop/login_service_linux.go`   and `login_seat_linux.go`: wakeup and physical-seat authority.

- Published native `login_latency_qualification_linux_test.go`,   `login_text_qualification_linux_test.go` and   `login_unlock_qualification_linux_test.go`: host measurements and assertions.

- Published web `createRemotePointer` and `createRemoteInput`: bounded motion,   physical/text modes and focus modifier preservation.

Raw host logs and test material remain outside maintained source. They contain neither passwords nor diagnostic input contents.
