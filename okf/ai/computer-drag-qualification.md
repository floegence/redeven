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

## Browser — October 28

Six Chromium regressions fail before repair/pass afterward: duration0/1/500/5000, image coordinates, managed/connected transports and cancellation/takeover/document/uncertain-effect interruption.5000ms delivered spans: managed5007.3ms, connected5004.1ms.145 focused Node assertions, full internal/ai, vet and four safety fixtures pass. Fix is shared Redeven CDP adapter; dependencies unchanged.

DeepSeek Flash1017:11 scenarios×3=33 tasks;27 original passes, five assertion defects (three codes/two unrequested single-call requirements), one model-added click. Corrected assertions:4/6 additional pass; invalid wait/omitted requested wait remain model failures. All six invalid-duration tasks reject before input then perform one timed drag. Reports stay distinct; no zero-error/probability claim.

## Native — October 28

Published floe-native-apps schedules from one monotonic origin after acknowledged mouse-down. Redeven retains authorization/receipts/held-input cleanup, with no app-specific recovery. Independent AppKit receiver reproduces old500ms request releasing~17ms. Repaired upstream0/1/500/5000 requests deliver1.11/2.76/501.79/5001.71ms; cancelled5000ms releases113.91ms before endpoint. Production helper passes five direct cases,500/5000 measured503.42/5005.30ms.

DeepSeek V4.1 Flash1017: five scenarios×3 (timed/invalid/zero drag, tree/text),11 original passes; three native rejection assertions wrongly expect browser fields and one parser stops at a label brace. Retain those test defects separately. One tree task has four model field errors before observation/one confirmed input. Six corrected validation/tree tasks pass; intentional invalid durations always reject before input.

Upstream Swift covers boundaries/slow receipts/cancel/unknown effects/ordinary input. Go protocol rejects fractional/nonfinite/out-of-range before integer conversion. Three-tool surface/prompt unchanged; help states range/straight-path/timing limits.

Nine more browser tasks (timed/invalid/batch,three each) pass. Earlier unanchored selector accidentally selects three native cases without opt-in and fails before their model runs; retain its nine browser reports separately. Precisely selected rerun9/9, sometimes with syntax/argument/nonactionable-target errors before recovery; final success does not certify every call.

Final v0.25.1 passes five direct cases, affected Go/vet,38 Swift and normal commit gate; macOS bytes match earlier candidate. Five final model tasks4/5: valid drag rejected TAKEOVER_REQUIRED before input. Three validation repeats2/3: receiver sees extra release of unknown origin. Neither failure is silently passed/classified as model error. Receiver adds source PID/marker without filtering/weaker assertions. Three subsequent tasks pass with one marked source and1002.99–1003.62ms spans. This cannot identify the earlier source; originals remain. Production takeover policy unchanged.
