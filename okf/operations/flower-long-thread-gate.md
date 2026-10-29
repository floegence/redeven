---
type: Validation Contract
title: Flower explicit long-thread qualification
tags: [flower, performance, correctness, gates]
lifecycle: contract
reviewed_at: "2026-10-29"
---
# Summary

Complete long-conversation content and responsive interaction are required product properties. Run this fixed-budget suite explicitly for acceptance/investigation, outside unified commit, integration and CI gates; it is not a prerequisite for each commit.

# Contract

## Explicit execution and provenance

Run node scripts/check_flower_long_thread.mjs --fast for focused regressions; omit --fast for browser correctness/sustained runtime. Install frozen published Desktop/Env App dependencies. Visible composited Electron is required; missing prerequisites fail, never skip. Unified gate manifests/entrypoints must exclude this suite.

Retain source commit/tree, cleanliness, toolchain/dependency hashes, metrics and supervised cleanup. Product/dependency changes invalidate prior performance evidence. Policy-only changes may cite earlier results with explicit unchanged-product comparison/separate policy tests, never label the unmeasured tip tested.

Nonzero exits, missing tests/tools/metrics, interruptions or cleanup failure fail acceptance. Retain the negative 110 ms presented-latency/21 position-commits-per-second regression and ordinary-profile exclusion test. No workload/threshold overrides or waived failures.

## Correctness

Fast suites protect indexed records, ordered queues, retention/windows, turn/disclosure identity, block-boundary invalidation, keyed disposal, local thinking, structural/mutable dependencies, sealed-body handoff and incremental Markdown.

One mounted owner per tool-sequence entry retains classification while live state, pending bodies, previews and first non-whitespace prose boundary remain reactive; removed owners dispose. Title identity classifies once; inspect visibility only when admitted/claimed. Group changes cannot rescan completed bodies; restored/reconnected titles stay static. Cover 600 retained rows and genuine browser arrival motion.

Stable groups own disclosure observers; growth/title motion publishes only changed blockers and removed groups dispose observations. A 600-group regression rejects repeated historical folds. Body chunks extend admitted items without advancing timeline restoration provenance; full hydration retains its boundary. Root/child browsers protect fresh motion against body/live historical rescans. Correct anchors synchronously only on loading completion, not retained-byte growth.

Structural batches publish membership once after affected records are ready, without document rescans per replacement. Parent-event intervals track membership/coverage independently of cache-wide text; immutable turn facts add no per-field subscriptions. Browsers also cover history/reconnect/selection/disclosure/input/approval/terminal state.

Sustained workload: 500 real canonical turns, 1,000 messages and 1,000 completed tools through Service/published Floret/deterministic fake providers, fully verified after admission. No real provider/user state/raw DB edits/product fallback. Generate mixed text/reasoning/Markdown at 80 updates/s, a tool every 60 updates, and 32 KiB initial body. Preserve rate independently of UI; accumulate at least 120 seconds in one active turn before late sampling.

After stopping, compare every generated prose/reasoning item and exact code blocks against canonical content/full Markdown through real history/disclosure controls. Wait for observed terminal state, enter reading mode, reveal sections before descendants; never force hidden clicks or mutate disclosure state. Draft/focus/selection survive drag. Synthetic floating output does not qualify terminal emulation; browser regressions retain other interactions.

## Responsiveness

Sample idle, early, late and repeat on one visible production UI with two PersistentFloatingWindows, at least twelve monotonic seconds each. Cancellation/released buttons/blur/hidden document invalidates samples. The long-thread-only Electron host installs pointer isolation before showing its nonfocusable window and prevents native keyboard events; it remains visibly composited, and CDP input, DOM focus, handlers and interruption checks stay active. Assert both drafts before sampling and retain continuity checks throughout.

Read runtime counter before press; one CDP session presses/moves/releases without intervening backend requests. Use Chromium monotonic input timestamps, never Node wall time. Independent 60 Hz scheduling must offer at least 55 events/s; producer cannot await each dispatch. Require at least 45 actual position commits/s and 80% idle cadence.

Budgets: presented-drag P95 <=75 ms; work-minus-idle <=25 ms; at least 95% prose markers with P95 <=250 ms; frame P95 <=25 ms; live reactive apply P95 <=12 ms/max <=50 ms; no main-thread task >=100 ms. These are acceptance requirements, not claims of current success or physical mouse-to-photon measurement. Never relax for known long-active-turn regressions.

Trace pairs nested async slices by process/identity/scope. Only complete MOUSE_DRAGGED spans with compositor presentation enter quantiles; count coalesced/nonpresented spans separately. Require at least 30 presented samples/s. Healthy rAF alone proves no pointer responsiveness. No profiling/screencast during timing.

# Boundaries

Desktop supervisor owns fixture/build/Electron/state/profile/ports and verifies cleanup. Metrics/traces stay outside Git; reports identify source/locks/host. The local Go fixture exports private, exclusive-create setup/configuration/canonical evidence through an owner-selected directory handle. HTTP counters are projected to finite nonnegative safe integers; network response bodies and unknown fields cannot become evidence files. Dirty development samples cannot certify committed tips. Seeding verifies complete canonical results once instead of rescanning every prefix; coverage is unchanged.

Reduce synchronous envelope work through stable turn/row inputs, keyed subscriptions, linear membership and bounded offscreen layout with reading/selection/focus pins. Retain DOM/disclosure owners, including growing active turns; this is layout containment, not virtualization. Partition construction visits each retained entry once per structural change; never rescan the remaining active-turn suffix for each section. Preserve mounted partition keys through prepend, growth and completion. Preserve order/boundaries/full history/drafts/disclosure. Throttling, suppressed output, extra lifecycle or shortened fixtures cannot substitute.

Floe owns shared floating mechanics; Redeven owns projection. Published shimmer pauses decorative paint only during shared drag/resize, retaining identity/phase. Text/tokens/content/terminal state stay live. Browser checks cover release/cancellation/blur and preserved preview drafts/selection. Workload and budgets remain unchanged.

# Evidence

- [Explicit runner and regression suites](../../scripts/check_flower_long_thread.mjs)
- [Sustained runtime runner](../../scripts/qualify_flower_long_thread.mjs)
- [Budgets and fail-closed evaluator](../../scripts/flower_long_thread_contract.mjs)
- [Explicit-execution policy and negative tests](../../scripts/flower_long_thread_contract.test.mjs)
