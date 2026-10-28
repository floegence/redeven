---
type: Verification Evidence
title: Browser and native drag timing qualification
description: Retain browser and macOS timing evidence and separate model deviations from tool contract failures.
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
in that browser qualification. The subsequent native qualification below owns
evidence for the separate native repair.


## Native drag contract qualification — 2026-10-28

The Floegence-owned floe-native-apps implementation now schedules native
input against one monotonic origin after acknowledged mouse-down. Redeven uses
that public sequence through its existing authorization, event-receipt and held
input cleanup path. No application-specific detection or recovery was added.

A separate AppKit receiver reproduced the old implementation releasing a 500 ms
drag in about 17 ms. The repaired upstream receiver measured system event spans
of 1.11/2.76/501.79/5001.71 ms for requests of 0/1/500/5000 ms. Cancellation of a
5000 ms drag released after 113.91 ms without reaching the endpoint. The
production Redeven helper passed all five corresponding direct scenarios;
500/5000 ms requests measured 503.42/5005.30 ms. These are local event-delivery
measurements, not a guarantee that every application accepts a business action.

The configured real DeepSeek V4.1 Flash (1017) provider ran five native scenarios
three times: timed drag, invalid-duration rejection followed by a timed drag,
zero-duration drag, accessibility tree inspection and exact text entry. Eleven
original assertions passed. Three failures expected a browser-only diagnostic
field on a valid native rejection; one log parser stopped at a brace in a text
label before the complete JSON evidence. These are test defects, retained in
separate raw reports. One tree task also contained four model JavaScript field
errors before successful observation and a single confirmed input; those errors
remain model failures, not tool defects. Corrected validation/tree assertions
passed six additional real-model tasks. Intentional invalid durations were
rejected before input in every corresponding task.

Upstream Swift scheduling tests cover boundaries, slow receipts, cancellation,
unknown-effect failure and ordinary input. Downstream native protocol tests
reject fractional, non-finite and out-of-range durations before integer
conversion. The default three-tool surface and system prompt remain unchanged;
native help states the duration range, straight-path meaning and timing limits.


Nine additional real-model browser tasks (three repetitions of timed drag,
invalid-duration rejection and multi-page script batching) passed. An initial
command used an unanchored scenario selector, unintentionally admitted three
native cases without their required opt-in, and failed before those model runs;
its nine browser reports are retained separately. The precisely selected rerun
passed all nine assertions. Some successful tasks still contained model syntax,
argument or non-actionable-target errors before recovery; passing the final
fixture contract does not mean every model call was valid.

The final published v0.25.1 dependency passed all five direct native scenarios
and the affected Go consumers, vet, 38 Swift tests and the normal commit gate.
Its macOS implementation is byte-identical to the earlier qualified candidate.
Five final model tasks passed four assertions: one valid drag was refused with
TAKEOVER_REQUIRED before input. Three validation repeats passed two assertions;
the other receiver recorded an extra intermediate release from an unidentified
source. Neither failure is reclassified as a model mistake or silently passed.
The disposable receiver now records event source PID and marker without filtering
events or weakening assertions. Three subsequent validation tasks all passed,
with one marked source per run and 1002.99–1003.62 ms system-event durations.
That new evidence cannot retrospectively identify the earlier event source;
the original failed reports remain retained. No production takeover rule changed.
