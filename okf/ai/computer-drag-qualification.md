---
type: Verification Evidence
title: Browser and native drag timing qualification
tags: [ai, computer-use, testing, evidence]
lifecycle: active_evidence
reviewed_at: "2026-10-28"
---
# Summary

Browser drag timing is measured from actual input events, with all model and
assertion failures retained. [Script contracts](computer-use-scripts.md) define
behavior; [qualification](computer-use-qualification.md) defines the test lane.
Browser measurements certify only the tested browser paths and durations.

# Contract

Measure drag duration between delivered press and release events. Keep
deterministic adapter assertions separate from real-provider task outcomes,
and retain original failures when correcting test expectations.

# Boundaries

Browser qualification neither changed nor timed native delivery. The subsequent native repair has separate evidence. Local event spans do not guarantee arbitrary application actions or general model reliability. Retain all original failures.

# Evidence

October 28 browser regressions reproduced duration, coordinates, both transports and interruption boundaries. Repair passed focused Node/Go/vet checks; delivered 5,000-ms spans were ~5,007/5,004 ms. DeepSeek's original 27/33 retained five assertion defects and one extra click. Corrected repeats still failed invalid/omitted waits; invalid durations rejected before input. Later 9/9 browser tasks are separate and include recovered model errors.

Native monotonic scheduling reproduced an old 500-ms request releasing at ~17 ms. Published repair delivered ~502/5,002 ms, with early release on cancellation. Independent AppKit receipts and production-helper tests cover actual down/up/endpoints; Go rejects fractional/nonfinite/out-of-range values. Authorization, balanced cleanup and takeover remained unchanged.

Original native model 11/15 retained browser-field assertion defects and a parser defect; a tree task made four field errors before recovery. Corrected cases passed separately. Final v0.25.1 direct, Go/vet and Swift checks passed, but 4/5 model tasks retained TAKEOVER_REQUIRED before input. Validation repeats retained one extra release of unknown origin. Adding source markers yielded three later passes (~1,003 ms) without explaining that earlier release. Original failures remain and are not silently classified as model errors. Browser tests do not certify native timing or arbitrary applications.
