---
type: Acceptance Record
title: Wayland cursor and scheduling optimization evidence
tags: [desktop, linux, wayland, validation, latency]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

Native 0.22.12 qualifies separate cursor/scheduling semantics with synthetic PipeWire frames. Input replies cannot block capture/authority; damage must retain post-gap changes. Fresh GNOME consent fails HOST_CONSENT_TIMEOUT, so distribution tests establish no live-GNOME latency. October 5 user waiver covers udesk24 performance only.

# Contract

[Media](../architecture/remote-desktop-media.md) owns behavior. Missing negotiated cursor metadata fails explicitly. Published ba8ecda3 verifies via proxy/SumDB; source integration never restarts Runtime.

# Boundaries

Hardware preferences follow actual capability, not claimed GPU selection. [Earlier Wayland](remote-desktop-wayland-results.md) cannot certify this candidate. Git retains exact source, private evidence path and qualification failures.

# Evidence

- `pipewire-qualification.log` and `portal-input-qualification.log`: isolated installed-library paths, transitions and ordered releases.

- `damage-benchmark.json` and `benchmark-damage.py`: synthetic static-buffer observation with retained baseline code.

- `upstream-main-push-final.log` and `upstream-qualification-status.json`: exact source and release qualification identity.

## Isolated Linux Native Paths
The private PipeWire fixture sends synthetic BGRA pixels, header sequences, VideoDamage and animated cursor metadata to the production client. There is no performance pass/fail threshold for this observation.

## Product And Distribution
The immutable v0.22.12 tag resolves through the Go proxy and checksum database to upstream commit `ba8ecda3294a732c25a4829734896139f6df7ad8`. Redeven consumes its published Go/Swift artifacts; local integration does not publish or restart the product Runtime.

Private task evidence: `task-evidence/desktop-cursor-ownership-20261005/`.
