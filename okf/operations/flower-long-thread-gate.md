---
type: Validation Contract
title: Flower explicit long-thread qualification
description: Protect complete conversation rendering and responsive interaction during sustained active-turn growth.
tags: [flower, performance, correctness, gates]
lifecycle: contract
reviewed_at: "2026-10-28"
---
# Summary

Long conversations must preserve complete content and responsive interaction while
work continues. This is a required product property, not optional release tuning.
The long-thread suite runs explicitly for acceptance or targeted investigation.
It is not registered in unified commit, integration or CI gates, and is not a
prerequisite for each commit. Keep the independent suite and fixed budgets available
without adding its setup and sustained measurement cost to ordinary development.

# Contract

## Explicit execution and provenance

Run node scripts/check_flower_long_thread.mjs --fast for focused regressions,
or omit --fast for browser correctness and the sustained real-runtime scenario.
Install frozen published Desktop and Env App dependencies before testing. A visible
composited Electron environment is required; unavailable prerequisites are failures,
not skips. Unified gate manifests and entrypoints must not invoke this suite.

Retain the tested source commit/tree, clean status, toolchain, dependency hashes,
metrics and supervised cleanup evidence. Product or dependency changes invalidate
their earlier performance result. A later policy-only change may cite that result
only with an explicit unchanged-product comparison and separate policy tests; never
label the unmeasured final commit as performance-tested.

Nonzero exits, absent tests/tools, interrupted runs, missing metrics and cleanup
failures fail the explicit acceptance. Negative tests retain the observed 110 ms
presented-latency / 21 position-commits-per-second regression. A lightweight runner
test verifies ordinary profiles exclude this qualification. A failed run is evidence
of failure, never a waived pass. No workload/threshold overrides are accepted.

## Correctness

Fast suites protect indexed record stability, ordered live queue semantics,
retention/reading windows, turn/disclosure identity, per-block content-boundary invalidation, keyed subscription disposal, local thinking
updates, structural versus mutable field dependencies, sealed-body handoff and incremental Markdown.
Tool sequence classification has one mounted owner per entry: retained rows reuse
classified facts while live state, pending bodies, preview labels and the first
non-whitespace prose boundary remain reactive. Removed entries dispose their owners.
Title arrivals classify identities once per mounted entry and inspect visibility
only when admitted and claimed. Group/disclosure changes cannot rescan completed
title bodies; restored and reconnected titles remain static. Fast regressions
exercise 600 retained rows, and browser cases protect genuine arrival motion.
Stable tool groups own their disclosure observer. Tail growth and title motion
publish only changed group blockers; removed groups dispose their pending
observations. A 600-group regression rejects repeated historical fold checks.
Body chunks extend an already admitted item and never advance whole-timeline
restoration provenance. This preserves fresh title motion and prevents body/live
receipts from repeatedly observing every historical group. Full item hydration
retains its restoration boundary. Browser regressions cover root and child views.
Body receipts request synchronous anchor correction only when loading becomes
complete; growing byte extents of already retained content do not force layout.
Structural batches publish ordered membership once after every affected record is
ready; replacing many records must not rescan the full document for each record.
Parent-event reading intervals track membership and coverage independently of
cache-wide text updates; immutable turn facts do not allocate per-field subscriptions.
Browser suites additionally exercise history navigation, reconnect, selection,
disclosure ownership, input/approval and terminal states. The sustained scenario
creates 500 real canonical turns through the product Service and the published
Floret runtime with deterministic fake providers: 1,000 messages and 1,000 completed
tools, verified completely after admission. It does not use a real provider, user
state, raw database editing or product runtime fallbacks.

Generate mixed text, reasoning, Markdown and a tool every 60 provider updates at
80 updates/second, including a 32 KiB initial body. Preserve the actual workload
rate independently of UI responsiveness. Accumulate at least 120 seconds in one
active turn before late samples. After stopping, compare every generated prose
and reasoning item through real history/disclosure controls with canonical content
and full Markdown parsing, including exact code blocks. Draft, focus and selection
must survive drag. Browser regression suites retain the remaining interaction
contracts; the synthetic floating output is not a terminal emulator qualification.
Content inspection waits for the observed terminal state, enters reading mode,
and reveals measured history sections before operating their descendants. It
must not force clicks through hidden content or mutate product disclosure state.

## Responsiveness

Sample idle, early work, late work and a repeat on the same visible production UI
with two production PersistentFloatingWindows. Each sample lasts at least twelve
seconds measured with a monotonic clock. Pointer cancellation, released buttons,
window blur or a hidden document invalidates the sample. The visible test-only
Electron host ignores physical mouse events so normal desktop pointer motion
cannot cancel the independently injected CDP drag. Input handlers, compositor
presentation and every interruption check remain active. Read the runtime counter
before pressing, then use one CDP session for press, continuous movement and
release so no backend request pauses input establishment. Chromium timestamps
input on its own monotonic clock; injecting Node wall time can place the input
after its renderer processing and corrupt presentation spans. Independent 60 Hz CDP
input scheduling must offer at least 55 events/second;
awaiting every dispatch in the producer is prohibited. Require at least 45 actual
position commits/second and 80% of idle cadence, not merely low latency among the
few events the renderer happens to deliver.

Require presented drag latency P95 <=75 ms, a work-versus-idle penalty <=25 ms,
at least 95% of live prose markers observed with P95 <=250 ms,
frame interval P95 <=25 ms, live reactive apply P95 <=12 ms/max <=50 ms, and no
main-thread task >=100 ms. These are initial product acceptance budgets, not claims
that the current implementation passes or that CDP measures physical mouse-to-photon.
Do not relax them just to admit the known long-active-turn regression.

Chromium trace analysis pairs nested async slices by process, identity and scope.
Only completed MOUSE_DRAGGED spans with a compositor presentation stage enter the
presentation quantile; coalesced/nonpresented spans remain separately counted.
Require at least 30 presented samples/second. A healthy rAF average alone cannot
certify pointer responsiveness. No CPU profiling or screencast runs during timing.

# Boundaries

The desktop test supervisor owns the fixture, build, Electron, profile/state
directories and ports, and verifies cleanup before reporting success. Synthetic
metrics/traces remain outside Git. The report records source, lock hashes and host;
standalone dirty development measurements do not certify an exact committed tip.
Historical seeding verifies the full canonical result once instead of rescanning
the complete prefix after each admission; this changes setup cost, not coverage.

Optimization must reduce the synchronous work per envelope: stable per-turn and
per-row inputs, keyed mounted subscriptions, linear membership checks, and bounded
offscreen layout with reading/selection/focus pins. Layout sections retain their
DOM and disclosure owners; this is layout containment, not DOM virtualization.
Skipping offscreen layout must also cover a growing active turn. Preserve canonical order and semantic boundaries,
full history access, drafts and disclosure state. Throttling, suppressed output,
a second lifecycle, or shortened fixtures cannot substitute for those invariants.
Shared floating-window mechanics belong to Floe; product projection belongs here.
Floe's published progress shimmer pauses only its decorative paint while its shared
drag/resize marker is active, preserving animation identity and phase on release.
Progress text, token counts, streamed content and terminal state remain live. Browser
regressions cover native release, pointer cancellation and window blur, including
preserved preview drafts and selection. The acceptance workload and latency budgets
remain unchanged; disabling streaming or masking failure cannot satisfy this rule.

# Evidence

- [Explicit runner and regression suites](../../scripts/check_flower_long_thread.mjs)
- [Sustained runtime runner](../../scripts/qualify_flower_long_thread.mjs)
- [Budgets and fail-closed evaluator](../../scripts/flower_long_thread_contract.mjs)
- [Explicit-execution policy and negative tests](../../scripts/flower_long_thread_contract.test.mjs)
