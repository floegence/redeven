---
type: Validation Contract
title: Flower explicit long-thread qualification
tags: [flower, performance, correctness, gates]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Complete long-conversation content and responsive interaction are required product properties. Run this fixed-budget suite explicitly for acceptance/investigation, outside unified commit, integration and CI gates; it is not a prerequisite for each commit.

# Contract

## Execution and evidence
Run node scripts/check_flower_long_thread.mjs --fast for focused regressions; omit --fast for browser/sustained acceptance. Require frozen published Desktop/Env dependencies and visible composited Electron; unavailable prerequisites fail. The qualification host mirrors production Desktop's disabled background throttling so an inactive native window retains the same animation/timer policy. Unified gate manifests exclude this explicit suite.

Record exact source/tree/cleanliness, tools/dependencies, metrics and supervised cleanup. Changed product/dependencies invalidate performance evidence; policy-only changes may cite prior unchanged-product evidence separately, never relabel an unmeasured tip. Nonzero/interrupted runs, missing tests/metrics/tools or failed cleanup fail. Preserve negative 110 ms latency/21 commits-per-second regression and profile-exclusion test. No workload/threshold override or waived failure.

## Correctness
Fast checks cover indexed records, queues, windows, turn/disclosure identity, block invalidation, keyed disposal, local thinking, structural/mutable dependencies, sealed bodies and incremental Markdown. Each sequence entry has one mounted owner; classification stays stable while live fields and first-prose boundaries update. Removed owners dispose. Title identity classifies once, visibility only on admission/claim; grouping never rescans completed bodies. Restored titles stay static. Cover 600 retained rows and actual browser arrival.

Per-group disclosure observers update only changed blockers; removed groups dispose. A 600-group case forbids repeated historical folding. Body growth cannot advance restoration provenance; full hydration retains its boundary. Root/child regressions preserve fresh motion through history scans. Correct anchors synchronously on loading completion, not byte growth. Structural batches publish membership once after records are ready, without per-replacement rescans. Parent intervals own coverage independently of text; immutable turn facts add no per-field subscriptions. Cover history/reconnect/selection/input/approval/terminal state.

Sustained fixture creates 500 canonical turns, 1,000 messages and 1,000 tools through real Service/published Floret/fake providers, verifying all admitted content. No paid provider, user state, raw DB writes or product fallback. Produce mixed text/reasoning/Markdown at 80 updates/s, one tool per 60 updates and initial 32 KiB body independently of UI; accumulate >=120 seconds in one active turn.

After canonical terminal observation, use actual history/disclosure controls to compare every generated prose/reasoning item and exact code blocks with canonical content/full Markdown. Enter reading mode and reveal parents before children; never force hidden clicks/change disclosure state. Draft/focus/selection survive drag. Synthetic floating output does not qualify terminal emulation.

## Responsiveness
Sample idle/early/late/repeat on the same visible production UI with two PersistentFloatingWindows, >=12 monotonic seconds each. Cancellation, button release, blur or hidden document invalidates samples. Dedicated nonfocusable Electron host uses the primary display work-area origin for repeatable visible placement and installs pointer isolation before showing, preventing native keyboard input while retaining real composition, CDP input, DOM focus and interruption checks. Assert both drafts before and throughout sampling.

Read counter before press; one CDP session performs press/move/release with no intervening backend calls. Use Chromium monotonic timestamps. Independent 60 Hz producer cannot await dispatch: offer >=55 events/s and require >=45 position commits/s and >=80% idle cadence.

Fixed budgets: presented drag P95 <=75 ms; work-minus-idle <=25 ms; >=95% prose markers with P95 <=250 ms; frame P95 <=25 ms; reactive apply P95 <=12 ms/max <=50 ms; no main-thread task >=100 ms. Known regressions do not relax them; they are requirements, not universal/photon claims.

Pair complete MOUSE_DRAGGED async spans by process/identity/scope with compositor presentation. Report coalesced/unpresented separately and require >=30 presented samples/s. Healthy rAF cannot prove input responsiveness. No profiling/screencast during timing.

# Boundaries

Desktop supervisor owns fixture/build/Electron/state/profile/ports and verifies cleanup. Metrics/traces stay outside Git; reports identify source/locks/host. The local Go fixture exports private, exclusive-create setup/configuration/canonical evidence through an owner-selected directory handle. HTTP counters are projected to finite nonnegative safe integers; network response bodies and unknown fields cannot become evidence files. Dirty development samples cannot certify committed tips. Seeding verifies complete canonical results once instead of rescanning every prefix; coverage is unchanged.

Reduce synchronous envelope work through stable turn/row inputs, keyed subscriptions, linear membership and bounded offscreen layout with reading/selection/focus pins. Retain DOM/disclosure owners, including growing active turns; this is layout containment, not virtualization. Partition construction visits each retained entry once per structural change; never rescan the remaining active-turn suffix for each section. Preserve mounted partition keys through prepend, growth and completion. Preserve order/boundaries/full history/drafts/disclosure. Throttling, suppressed output, extra lifecycle or shortened fixtures cannot substitute.

Floe owns shared floating mechanics; Redeven owns projection. Published shimmer pauses decorative paint only during shared drag/resize, retaining identity/phase. Text/tokens/content/terminal state stay live. Browser checks cover release/cancellation/blur and preserved preview drafts/selection. Workload and budgets remain unchanged.

# Evidence

- [Explicit runner and regression suites](../../scripts/check_flower_long_thread.mjs)
- [Sustained runtime runner](../../scripts/qualify_flower_long_thread.mjs)
- [Budgets and fail-closed evaluator](../../scripts/flower_long_thread_contract.mjs)
- [Explicit-execution policy and negative tests](../../scripts/flower_long_thread_contract.test.mjs)
