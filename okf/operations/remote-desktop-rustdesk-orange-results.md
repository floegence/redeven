---
type: Qualification Record
title: Orange RustDesk comparison attempts
description: Orange LAN instability and incomplete paired presentation evidence.
tags: [desktop, performance, qualification]
timestamp: 2026-10-13T09:04:00Z
---
# Summary

Published native v0.22.37 Orange evidence remains incomplete. The primary qualification task retains every failed response and carrier recovery attempt. Unstable networking prevents three complete paired rounds; udesk26 evidence cannot qualify Orange hardware.

# Contract

The [comparison owner](remote-desktop-rustdesk-comparison-results.md) defines the measurement and acceptance contract. This record preserves historical observations rather than current-product parity.

# Observations

Current published-candidate rounds retain every attempt. **Smooth** picture mode
and **Host input method** are selected for performance; earlier paste acceptance
uses **Use local input method**. The same 1920 × 1080 physical output is presented
in a 2880 × 1620 viewport. RustDesk retains AV1/I420, custom quality 100%, 60 FPS;
its adaptive bitrate falls during later rounds. Source scene v6 changes only
motion controls from letters to F6/F7 after the host input method intercepts `m`.

| Round / product | Idle responses | Matched idle P50 / P95 ms | Motion responses | Motion P50 / P95 ms | Presented FPS | Gaps >250 ms |
| --- | --- | --- | --- | --- | --- | --- |
| 1 / RustDesk | 100/100 | 190.34 / 292.66 | 100/100 | 117.34 / 361.58 | 22.37 | 45 |
| 1 / Redeven | 93/100 | 119.11 / 158.84 | 100/100 | 115.10 / 149.37 | 43.91 | 1 |
| 2 / Redeven | 100/100 | 128.06 / 179.93 | 100/100 | 117.44 / 165.58 | 42.81 | 0 |
| 2 / RustDesk | 98/100 | 308.95 / 838.28 | 100/100 | 156.25 / 606.92 | 16.07 | 72 |
| 3 / RustDesk | 66/100 | 295.09 / 928.13 | 100/100 | 283.14 / 1109.42 | 12.25 | 90 |

Matched-only percentiles exclude unanswered trials and cannot establish full
acceptance tails. Every listed measured source receives 100 inputs; preliminary
RustDesk captures with 70 or 50 observed inputs remain incomplete. The initial
round-two idle observer expires after 50 inputs; its replacement observes 100.
CUA batch pauses extend actual workload durations; resource comparisons must
use recorded intervals and rates, not nominal 60/85-second labels.

After round-one Redeven motion, the SSH carrier ends. Runtime and root service
remain alive, but automatic Viewer retries fail and the expired lease requires
a fresh Env App connection. The [Orange functional record](remote-desktop-orange-viewer-results.md) proves
exact native media worker recovery; that does not
establish SSH carrier recovery. Round-three RustDesk later disconnects and asks
for remote acceptance again. Independent SSH evidence retrieval also times out;
partial source files remain distinguishable from complete evidence.

A later Orange LAN probe receives 4/8 packets, with 50% loss and RTT
1515.379/1787.054/2100.008 ms min/mean/max. This identifies unstable conditions,
not the cause of each product tail. The control Mac is unlocked. The operator
requests udesk26 for the remaining comparison; Orange's third Redeven half is
not run. udesk26's ten-packet preflight has zero loss and RTT
5.177/7.716/10.346 ms. Its 1920 × 1280 physical output and fractional scale require
fresh marker calibration and an independent comparison; its results cannot
qualify Orange's hardware.

Round-two static text crops appear comparably readable, but motion quality,
source-age clock uncertainty, exact-window resources and all 30-second static
samples remain incomplete. One RustDesk static capture lasts about 19 seconds
and does not satisfy the contract. No resource or bandwidth parity is claimed.
Raw captures, source inputs, process identities and failed attempts live in the
task's `v37-paired-20261012` evidence set; it is an interim record, not completed
three-round acceptance.

# Evidence

- [Official RustDesk 1.5.0 release](https://github.com/rustdesk/rustdesk/releases/tag/1.5.0): baseline artifacts.
- [Comparison owner](remote-desktop-rustdesk-comparison-results.md): current candidate and acceptance status.
