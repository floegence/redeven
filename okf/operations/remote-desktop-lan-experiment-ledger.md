---
type: Qualification Record
title: LAN desktop experiment decision ledger
description: Consult historical winners, rejected hypotheses and retry conditions before another LAN performance experiment.
tags: [desktop, performance, experiments]
timestamp: 2026-10-15T02:00:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

The LAN record shows a measured deficit without establishing its cause or full
RustDesk parity. The published v0.22.48 six-frame path reached 53.04 FPS in one
round, but did not restore three-round stability. C01-C03 hypotheses were
rejected; C04 supports optional Linux six-frame delivery as a throughput
diagnostic only. C05 owns current paired results and remaining limits.

# Contract

Before another run, review the [C05 preparation and compatibility contract](remote-desktop-lan-published-c05.md), the [measured C05 results](remote-desktop-lan-c05-results.md), and the [RustDesk acceptance criteria](remote-desktop-rustdesk-comparison-results.md). Retry only a named fixture repair or a discriminating hypothesis. Preserve candidate and fixture identities, every attempted round, source and response counts, and the reason for excluding invalid input. Never remove adverse completed trials.

Keep each experiment separate from product qualification. Restore the verified published service after diagnostics, and never include credentials in the record.

## Decision record
C01's historical crossover remains a counterexample, not a current performance claim. C02 found no production benefit from confirmed-receipt batching and did not justify a product change. C03's exhausted-window timer was rejected. C04's four/six-frame comparison supports the optional Linux path, not parity or root-cause attribution. The detailed run records were removed from the current tree; Git history retains them.

# Boundaries

Results apply only to the recorded hardware, published versions and fixture.
Cross-time measurements do not prove causality. C05's missing source input
invalidates ordinal latency association, while missing presentation with
complete source input remains an adverse result. No performance result waives
security, authorization, input, ordering or recovery contracts.

# Evidence

- [C05 preparation](remote-desktop-lan-published-c05.md) - Published dependency identity and fixture boundaries.
- [RustDesk comparison](remote-desktop-rustdesk-comparison-results.md) - Acceptance criteria and parity limits.
