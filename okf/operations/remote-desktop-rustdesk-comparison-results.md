---
type: Qualification Record
title: Physical desktop RustDesk comparison
tags: [desktop, performance, qualification]
lifecycle: active_evidence
reviewed_at: "2026-10-25"
---
# Summary

Full RustDesk parity/historical repeatability remain unaccepted. Native v0.22.48 six-frame, three rounds: mean FPS 46.21 vs 32.54; pooled P95 310.60 vs 207.59 ms; >250ms gaps nine vs three. Round three reaches 53.04 FPS/150.20ms with no gaps, but cannot replace adverse round one. Preserve safeguards; C05/decision ledger own results and experiments.

# Contract

## Method And Acceptance
The official baseline is RustDesk `1.5.0`, source `fada664df7a294d1d1a9ca3e7cd3637069122f17`.

Three paired alternating rounds must retain physical output, resolution, refresh rate, content viewport and delivered detail quality, with one measured Viewer at a time.

Whole-tree resources and incremental Viewer costs are distinct observations; baseline subtraction cannot silently replace whole-tree reporting.

# Boundaries

Results apply only to the recorded hardware, path and fixture. Unsupported physical platforms cannot inherit Linux qualification; macOS and legacy four-frame contracts remain distinct. Unmeasured hardware decoding and photon latency remain unclaimed.

# Evidence

- [C05 measured results](remote-desktop-lan-c05-results.md): current paired outcomes, adverse trials and unresolved boundaries.

- [LAN experiment decision ledger](remote-desktop-lan-experiment-ledger.md): concise conclusions for older hypotheses and current retry conditions.

[C05 preparation and compatibility](remote-desktop-lan-published-c05.md) records published v0.22.48, consumer identity, source-only tests, platform contracts, release qualification and the reboot boundary. No complete parity claim follows from the six-frame diagnostic's 52-53 FPS.
