---
type: Qualification Record
title: Physical desktop RustDesk comparison
description: Apply paired presentation, detail, compatibility and resource criteria before accepting RustDesk parity.
tags: [desktop, performance, qualification]
timestamp: 2026-10-15T13:00:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-25"
---
# Summary

The primary qualification task owns acceptance. Full RustDesk parity and
repeatable restoration of historical performance remain unaccepted. Published
native v0.22.48 with negotiated six-frame delivery averages 46.21 FPS against
RustDesk 32.54 FPS in three retained motion rounds. Candidate pooled P95 is
310.60 ms against 207.59 ms, with nine versus three gaps over 250 ms. Candidate
round three reaches 53.04 FPS/P95 150.20 ms with no long gaps, but the adverse
first round cannot be replaced. Keep current security, authorization, confirmed
paint, ordering and recovery safeguards. The [C05 result](remote-desktop-lan-c05-results.md) owns current
results and open cases; the [decision ledger](remote-desktop-lan-experiment-ledger.md)
records adopted, rejected and unresolved experiments.

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
