---
type: Validation Contract
title: Flower explicit long-thread qualification
tags: [flower, performance, correctness, gates]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Complete conversations and responsive interaction are required. Run fixed-budget long-thread checks explicitly for acceptance/investigation, outside commit/integration/CI gates. Preserve failures and exact source/cleanup evidence; neither a reduced workload nor prior-tip timing qualifies changed product code.

# Contract

## Execution/evidence
node scripts/check_flower_long_thread.mjs --fast runs focused regressions; omit flag for sustained/browser. Frozen published Desktop/Env dependencies and visible composited Electron required. Host matches production disabled background throttling for inactive-window timers/animation. Unified gates exclude suite.

Record source/tree/cleanliness/tools/dependencies/metrics/supervised cleanup. Product/dependency changes invalidate timing; policy-only may cite unchanged-product evidence without relabeling tip. Nonzero/interrupted/missing metric-test-tool/cleanup failure fails. Retain110ms/21commits-s negative regression and profile-exclusion test; no threshold/workload override or waiver.

## Correctness
Fast checks cover indexed records, queues, windows, turn/disclosure identity, block invalidation, keyed disposal, local thinking, structural/mutable dependencies, sealed bodies and incremental Markdown. Client cases run in the Desktop browser-conditioned Solid/jsdom configuration. Each sequence entry has one mounted owner; classification stays stable while live fields and first-prose boundaries update. Removed owners dispose. Title identity classifies once, visibility only on admission/claim; grouping never rescans completed bodies. Restored titles stay static. Cover 600 retained rows and actual browser arrival, incremental DOM placement, plain-versus-reactive cache ownership and user-only prompt-history subscriptions.

Per-group disclosure observers update only changed blockers; removed groups dispose. A 600-group case forbids repeated historical folding. Body growth cannot advance restoration provenance; full hydration retains its boundary. Root/child regressions preserve fresh motion through history scans. Correct anchors after the synchronous completion render, before paint, not on each byte. Cold-history regressions sample every frame across preview publication, pending status and large Markdown completion while live output and native upward wheel input continue; checking only settled offsets misses transient jumps. Structural batches publish membership once after records are ready, without per-replacement rescans. Parent intervals own coverage independently of text; immutable turn facts add no per-field subscriptions. Cover history/reconnect/selection/input/approval/terminal state.

Sustained fixture creates 500 canonical turns, 1,000 messages and 1,000 tools through real Service/published Floret/fake providers, verifying all admitted content. No paid provider, user state, raw DB writes or product fallback. Produce mixed text/reasoning/Markdown at 80 updates/s, one tool per 60 updates and initial 32 KiB body independently of UI; accumulate >=600 seconds in one active turn. Two-minute success cannot qualify longer accumulation.

Export canonical terminal outcome and failure before waiting for UI completion so engine failures cannot appear as unexplained UI timeouts. Require successful canonical and observed completion, then use actual history/disclosure controls to compare every generated prose/reasoning item and exact code blocks with canonical content/full Markdown. Enter reading mode and reveal parents before children; never force hidden clicks/change disclosure state. Draft/focus/selection survive drag. Synthetic floating output does not qualify terminal emulation.

Allow preparation, ten-minute output and complete post-timing inspection to finish within the supervised fixture lifetime. Each generated item opens only its owning sequence through the real disclosure control; do not repeatedly open unrelated historical groups. A 1,200-row regression forbids geometry reads for preserved/appended baselines and verifies exact interior-gap height after removal. Actual folding still protects selection, focus and inspected content.

## Responsiveness
Sample idle/early/late/repeat on the same visible production UI with two PersistentFloatingWindows, >=12 monotonic seconds each. Cancellation, button release, blur or hidden document invalidates samples. Dedicated nonfocusable Electron host uses the primary display work-area origin for repeatable visible placement and installs pointer isolation before showing, preventing native keyboard input while retaining real composition, CDP input, DOM focus and interruption checks. Assert both drafts before and throughout sampling.

Read counter before press; one CDP session press/move/release, no backend calls between. Chromium monotonic time; independent60Hz producer cannot await dispatch. Offer>=55events-s, require>=45position-commits-s and>=80% idle cadence.

Budgets: drag P95<=75ms,work-minus-idle<=25ms; >=95% prose markers/P95<=250ms; frame P95<=25ms; reactive P95<=12ms/max50ms; no main-thread task>=100ms. Regressions never relax budgets; no universal/photon claim.

Pair complete MOUSE_DRAGGED async spans by process/identity/scope to compositor presentation. Report coalesced/unpresented separately;>=30presented-s. Healthy rAF is not input proof. No profiling/screencast during timing.

# Boundaries

Desktop supervisor owns fixture/build/Electron/state/profile/ports and verifies cleanup. Keep metrics/traces outside Git with source/locks/host. Go fixture exports private exclusive-create config/canonical evidence through owner-selected directory handle. Only finite nonnegative safe-integer HTTP counters; response bodies/unknown fields never become evidence files. Dirty samples certify no commit. Seed complete canonical results once,not each prefix,without reducing coverage.

Optimize stable inputs/keyed subscriptions/linear membership/bounded offscreen layout with reading-focus-selection pins. Retain DOM/disclosure even growing active turns: containment,not virtualization. Visit entries once/structural change,not suffix per section; keep partition keys through prepend/growth/completion and preserve full order/history/drafts/choices. No throttling,suppressed output,new lifecycle or shorter fixtures.

Floe owns shared floating mechanics; Redeven owns projection. Published shimmer pauses decorative paint only during shared drag/resize, retaining identity/phase. Flower observes that same DOM gesture owner once per surface: active title/disclosure motion settles, incoming titles remain fully readable, semantic tool icons become static, and CSS activity indicators stop animating. Automatic tail following continues without its optional easing during manipulation; reading anchors and native wheel handling remain owned by the existing scroll controller. Release, cancellation and blur restore the accessibility preference; old arrivals never replay and only subsequent arrivals animate. Expanded reasoning uses the same preference. Normal reading retains its smooth motion. Text/tokens/content/terminal state stay live. Browser checks cover release/cancellation/blur and preserved preview drafts/selection. Workload and budgets remain unchanged.

# Evidence

- [Runner/regressions](../../scripts/check_flower_long_thread.mjs)
- [Sustained runner](../../scripts/qualify_flower_long_thread.mjs)
- [Budgets/evaluator](../../scripts/flower_long_thread_contract.mjs)
- [Policy/negative tests](../../scripts/flower_long_thread_contract.test.mjs)
