---
type: Acceptance Record
title: Wayland cursor and scheduling optimization evidence
description: Assess separate cursor ownership, ordered nonblocking input and damage-aware capture without confusing synthetic results with desktop latency.
tags: [desktop, linux, wayland, validation, latency]
timestamp: 2026-10-04T18:10:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-25"
---
# Summary

Native v0.22.12 owns cursor/scheduling evidence; session/viewer contracts retain authority. Separate-cursor frames exclude pointer pixels; view-only keeps them. Input replies cannot block capture/authority, and damage cannot hide post-gap changes. Distribution/browser tests do not prove GNOME latency. User waived udesk24 performance on 2026-10-05, not functional regression.

# Contract

The GNOME portal advertises cursor metadata, but the preceding native component requested embedded capture while the viewer showed a local pointer. Missing cursor metadata in a negotiated metadata stream fails explicitly; it cannot prove embedded pixels.

The published hardware encoder and decoder-preference optimizations remain available according to actual platform capabilities; this change cannot establish that a browser selected a particular physical GPU.

# Boundaries

A fresh GNOME sharing request timed out with `HOST_CONSENT_TIMEOUT`. Historical real-desktop measurements remain in the [Wayland results](remote-desktop-wayland-results.md) and must not be relabelled as evidence for this candidate.

# Evidence

- `pipewire-qualification.log` and `portal-input-qualification.log`: isolated installed-library paths, transitions and ordered releases.

- `damage-benchmark.json` and `benchmark-damage.py`: synthetic static-buffer observation with retained baseline code.

- `upstream-main-push-final.log` and `upstream-qualification-status.json`: exact source and release qualification identity.

## Isolated Linux Native Paths
The private PipeWire fixture sends synthetic BGRA pixels, header sequences, VideoDamage and animated cursor metadata to the production client. There is no performance pass/fail threshold for this observation.

## Product And Distribution
The immutable v0.22.12 tag resolves through the Go proxy and checksum database to upstream commit `ba8ecda3294a732c25a4829734896139f6df7ad8`. Redeven consumes its published Go/Swift artifacts; local integration does not publish or restart the product Runtime.

Private task evidence: `task-evidence/desktop-cursor-ownership-20261005/`.
