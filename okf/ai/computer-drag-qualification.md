---
type: Verification Evidence
title: Browser drag timing qualification
description: Retain deterministic timing evidence and separate model deviations from browser contract failures.
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

# Evidence

## Browser drag contract qualification — 2026-10-28

The original six Chromium regressions failed before the repair. All six pass
with duration 0/1/500/5000, image coordinates, managed/connected transports and
cancel/takeover/document/unknown-effect interruption. At 5000 ms the recorded
press-to-release times were 5007.3 ms managed and 5004.1 ms connected. Another
145 focused Node assertions, full internal/ai tests, go vet and four host-safety
fixtures passed. Published dependencies remain unchanged; this repair belongs
to Redeven's shared CDP adapter, not Floret or the native event library.

The configured real DeepSeek Flash 1017 provider ran 33 tasks across 11 scenarios
(three repetitions each): 27 original assertions passed, five failed because of
incorrect test expectations (three wrong error codes and two unrequested
single-call requirements), and one failed because the model added a click.
Correcting only those assertions produced four passes in six additional tasks;
the remaining two were a model-supplied invalid wait condition and an omitted
requested wait. Raw reports remain distinct. All six invalid-duration tasks
rejected before input and then performed one timed drag. These results do not
claim zero model errors or a general success probability.

# Boundaries

Native macOS event construction/delivery was reviewed but not changed or timed
in this browser qualification. Its duration currently affects path sampling
without an explicit elapsed-time schedule. A native repair needs upstream-owned
scheduling and native delivery evidence; browser success must not certify it.
