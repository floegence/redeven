---
type: Qualification Record
title: Physical desktop responsiveness and local input
tags: [desktop, input, drm, latency, qualification]
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

Native v0.22.33 wakes idle capture; Floe owns bounded pointer/local text. Media/viewer contracts own authority/modes; locks are physical-only and generation/mode changes revoke input. Document contents, DRM feedback and encoded arrival are separate checks. udesk26 passes; Orange AFBC follow-up owns later repair. Native success is not complete Viewer/performance acceptance.

# Contract

## Diagnosis and changes
Released `text_input` separates local composition from clipboard synchronization.

The earlier results do not qualify that new setup; no permanent display policy was changed.

## Native input comparison
Each of three rounds uses 100 pointer moves at 1920 maximum dimension, 15 FPS and original pixels. udesk26 is amd64/1920x1280; orange is arm64/1920x1080.

| Host and version | Input receipt | Matching DRM feedback |
| --- | --- | --- |
| udesk26 v0.22.32 | 3.699 / 4.194 / 3.696 | 17.659 / 17.692 / 18.118 |
| udesk26 v0.22.33 | 7.655 / 7.191 / 10.015 | 16.946 / 17.094 / 17.039 |
| orange v0.22.32 | 5.060 / 6.750 / 5.678 | 5.498 / 6.523 / 6.035 |
| orange v0.22.33 | 11.566 / 12.063 / 14.842 | 8.907 / 7.869 / 11.809 |

## Physical-host qualification
Both hosts previously passed native attachment, current-frame admission, retired-generation rejection, teardown, ASCII/Chinese/emoji text and Enter.

Subsequent source inspection and real pixels proved that canonical AB24 import succeeds with a bounded component-order normalization.

Explicit OS authorization retains its user-driven lifecycle.

## Client and idle CPU observations
Real CUA drags with one controlling udesk26 Viewer produced cursor-feedback P95 44.0 / 41.2 / 47.6 ms, with only 6 / 8 / 6 matched observations. Input-result timing is excluded because the Runtime assigns native command IDs independently; naïve client-ID correlation is not authoritative.

No same-configuration baseline was captured in that round, so this does not establish a 70% reduction.

## Idle desktop response
At 60 FPS/original pixels, a GTK fixture toggles black/white on Space.

| Host and version | Round 1 | Round 2 | Round 3 |
| --- | --- | --- | --- |
| udesk26 v0.22.32 | 86.283 / 193.823 | 76.856 / 192.253 | 73.528 / 98.269 |
| udesk26 v0.22.33 | 73.765 / 94.790 | 62.772 / 84.435 | 50.607 / 89.433 |
| orange v0.22.32 | 241.530 / 267.476 | 255.642 / 282.653 | 246.081 / 257.422 |
| orange v0.22.33 | 96.195 / 265.283 | 100.704 / 274.402 | 103.856 / 224.087 |

## Lock input and regression boundaries
Released `physical-only` mode fixes orange's earlier lock-screen IME leak. Chromium/WebKit/Firefox upstream tests cover IME, empty codes, stale composition and release without weakening ordinary text input. udesk26 verified physical unlock. Orange's subsequent native invalid/valid unlock and successor-generation round is recorded in the AFBC qualification; its complete Desktop SSH Viewer acceptance remains a separate requirement.

# Boundaries

The candidate consumes public native v0.22.33 and web v0.86.19 and preserves current local-main changes.

Task ports are local 24236, udesk26 24246 and orange 24247; task Runtimes never bind 23998.

Full physical-host acceptance is incomplete.

# Evidence

- Published native `host_desktop_drm.py`, `hostdesktop/login_service_linux.go`   and `login_seat_linux.go`: wakeup and physical-seat authority.

- Published native `login_latency_qualification_linux_test.go`,   `login_text_qualification_linux_test.go` and   `login_unlock_qualification_linux_test.go`: host measurements and assertions.

- Published web `createRemotePointer` and `createRemoteInput`: bounded motion,   physical/text modes and focus modifier preservation.

Raw host logs and test material remain outside maintained source. They contain neither passwords nor diagnostic input contents.
