---
type: Verification Evidence
title: Computer use qualification evidence
tags: [ai, computer-use, testing, evidence]
lifecycle: retained_history
retention_reason: "Retains platform qualification failures and scope boundaries that prevent unsupported claims about current Computer Use behavior."
reviewed_at: "2026-10-29"
---
# Summary

The production qualification runners establish scope-specific outcomes under
[the acceptance contract](computer-use-qualification.md). The following results
include September and October 2026 runs. A passing worktree run does not replace the exact-main
pre-push gate, certify arbitrary applications, or turn earlier failed runs into
successes. Private text and pixels are excluded from retained diagnostics.

# Contract

Keep measurements bound to their declared platform, provider and source build. Never infer cross-platform success from one adapter or from a model request returning HTTP 200.

# Boundaries

The source runners, not these aggregate counts, define pass/fail invariants.

See the acceptance contract for cleanup, evidence binding and scope restrictions.

# Evidence

The live-model runs below use the configured local DeepSeek V4.1 Flash (1017), wire alias deepseek-flash. The alias does not prove remote weights. Source configuration/secrets remain unchanged; task-owned profiles/apps/state never continue user threads. Raw reports, including failures and private histories, remain outside Git. Final task success does not imply zero model errors, general reliability or complete platform qualification.

## October 29: tool result and interaction boundaries

Deterministic provider and executor fixtures pass four isolated Chromium workflows
through the real Service, canonical persistence and production FlowerSurface:
autonomous continuation after output loss, explicit model-selected input with
submission retry, cancellation of that input, and unavailable observation after
target disconnection. Each counts one effect and verifies no replay after reload
and restart. Offline completion reports unavailable observation, not verified state.
The Computer script runner passes 67 cases, including an unresolved Promise after
a confirmed click with no later click. These tests establish adapter behavior,
not the decision quality of a real model. Existing historical confirmations remain
answerable or cancellable after restart; the new policy does not auto-answer them.
See [browser fixture](../../internal/ai/computer_result_ui_test.go),
[model contracts](../../internal/ai/tool_design_contract_test.go) and
[historical input fixture](../../internal/ai/tool_design_history_test.go).

## October 28

Semantic scroll: original 29/36 strict assertions, with three incorrect zero-movement expectations despite reported scroll preparation and four model argument errors. Corrected evidence on the final implementation passes 20/24 (12 tasks twice). Failures remain positional-scroll object misuse, an undefined variable and two multi-page script errors. Six valid document/tall/clipped tasks dispatch one wheel and move; valid covered input dispatches none and retains preparation_executed. The other covered task fails before the adapter. Read recovery, full-name staleness, visual input, forms, tables and downloads pass both repetitions. No input replay or compatibility alias is added.

[Media/read qualification](computer-media-read-qualification.md) retains its separate deterministic checks, original 36 and supplemental six tasks, model errors and parser defects. [Drag qualification](computer-drag-qualification.md) owns timing and native event evidence.

## October 27: field integrity and generic contracts

Field-level truncation remains within 2,000 code points; complete-name digests fence references/cursors. Oversized scalar attributes fail explicitly. Deterministic tests first fail missing flags, tail-only mutation and old-ref rebinding, then pass Chromium, Go guest/diff, Swift and isolated AT-SPI paths. Execution checks: 226 Node passes/one existing optional skip; ten browser/UI/package suites: 314 passes; Swift: 36. Native protocol/safety/staging and full ai/appserver/focused race pass.

Real-model batch: 45/46 assertions, 236 requests, 196 activities, 35 errors including requested negatives. Native exact fill/one click/screenshot pass after stopping a pending Promise, but text-output assertion fails. Supplemental field/Unicode/native tests: 8/9, 77 requests, 67 activities, six errors; all six text cases pass, native 2/3. Remaining model suppresses snapshots and filters absent platform_role, so input/screenshot pass without text observation. Earlier 11/15 and 14/15 reports retain UTF-8 fixture, model-log-key and formatted-number assertion defects. Missing assets/config are preflight failures.

Generic contracts use published Floret v7.88.0 batch exclusion; unknown reads stop, HTML text reads never widen scope, platform permission facts still pause. First 40 model tasks pass; eleven cases ×3 give 32/33 original assertions. The remaining task completes after an invented visual.screenshot call but fails the overstrict zero-error assertion. Nine supplements retain three Activity-vs-canonical assertion failures, one omitted screenshot and five passes; final explicit mixed-batch checks pass 3/3. Browser/read checks 223/224 with one optional install skip; ten browser suites and Go/race/macOS/private-Linux checks pass. A combined helper timeout remains failed; independent and three repeated four-fixture runs pass. No model-specific recovery is added.

## October 27: scripts, downloads and native entry

Baseline 95fec361bdc2f23b7c27712cb0576f5dfa9f6f18; Floret v7.87.5, FloeBrowser 0.1.28, native 0.24.0, QuickJS 0.32.0, Playwright 1.63.0, Go 1.27.3/Node 26.7.0. Existing browser regression 22/22; native entry 5/5 (3 clean), export/file/CLI 5/5 (4 clean), multipage batch 4/5 (1 clean). Final-clarity 14/15 uses 112 requests/98 activities/11 errors; median native/mixed/batch 9,120/12,028/11,622 ms. Batch failure reads all pages and totals 42 but violates the unchanged two-transitions-in-one-call requirement. Prose cannot substitute for tool facts.

Retain final-core-v4 batch/mixed 5/5; final-delivery native/mixed 5/5 and batch 4/5 (DSML/final defect); final-tool-contract batch 3/5 (overstrict totals and stale-ref misuse). Pilot fixture ordering and NSWorkspace completion deadlock are repaired. Original reports are never overwritten or repeated until declared green.

Exact maintained examples execute through QuickJS→Runtime→Chromium: 1,400,000-byte download matches, one export/identity; scores 7/14/21 total 42 in one batch with globals and screenshot. Source isolation 9/9; initial fixture window.URL shadowing is fixed. Final ai/appserver 104.178/18.744s, race 7.409s, Node 179/two optional skips, Swift 35, native window selection 4/4; restoration/six safety/JSONL/relocated-package checks pass. Earlier external-focus restoration failure remains. Failed download writes preserve ready target state, clean partial files and never invent saved paths; failures before upstream download ID may still time out without filename/time inference.

## October 27: earlier lanes

- Recovery/native facade: 22 browser cases ×3 =66/66, 171.268s, 327 requests, median7,171.5ms; 210 successes/42 negative or recovered errors. Retain 19/22,65/66,64/66 failures. Browser313, execution142/one optional picker skip, Swift35. Real QuickJS/Go/Swift sees two wheels/offset200/screenshot and focus restoration; external input invalidates restoration. Built Desktop/Flash completes three native turns with clicks2→4, double-click, text/Enter, wheel240, decoded720×582 frames and canonical targets. No arbitrary AX/Linux/connected-Chrome model-chain claim. A later uncertainty/takeover regression clears residual media and passes ai98.411s; original restoration failure remains. Stage initially fails four checks; corrected finite-animation/preview waits yield11/11 with unchanged geometry/image assertions and retained ResizeObserver warnings.
- Coordinates/scripts, Floret v7.87.4/Chromium153.0.8010.12/macOS arm64: 19×3=57/57, median6,916ms;244 activities/34 negative or recovered errors. Real zoom80/100/125/150/200/220%, scales1/2 and offsets0/1500 verify decoded images/events, frames, scrollers, shadows and overlays. Snapshot450 nodes=27,478 bytes. Initial18/19 fixes malformed fixture onclick. Rejected retained-VM experiment could keep callbacks; final failure retires the namespace. Native foreground/Linux and a single built Desktop model chain remain excluded.
- Compact surface, source1140a827feb2d6acba7bc876337b93d4a698e99f/Floret v7.87.3:15×3=45/45 in153.609s, median8,115ms;210 activities/28 errors (15 required,13 recovered). Each image clicks once; each stale image rejects without input; one export/save and timeout guarantees hold. Retain earlier44/45, pre-canonical45/45, parser19/45 and interpretation39/45. Node64 and ai87.654s pass. Tool definition4212→975 characters is not measured token/latency gain; no paired baseline/native/arbitrary-site/full-Desktop claim.

## Earlier platform boundaries

September18 packaged extension installs in isolated Chrome/macOS. Linux deterministic staging/reveal does not certify native pickers. Reproduced iframe loss uses task-owned Runtime; built Desktop/Runtime/Chromium/extension/Native Messaging fake-model lanes qualify repair separately. Native clicks/text/scroll/frames and Linux cleanup preserve configuration. macOS foreground/background tests require unlocked console; lock-screen use is unsupported. [Performance](computer-use-performance.md) owns paired measurements, separate from exact-main qualification.
