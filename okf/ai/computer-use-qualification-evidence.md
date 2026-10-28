---
type: Verification Evidence
title: Computer use qualification evidence
description: Read measured browser and desktop outcomes without conflating adapter, model and final integration scopes.
tags: [ai, computer-use, testing, evidence]
timestamp: 2026-09-17T00:00:00Z
lifecycle: retained_history
retention_reason: "Retains platform qualification failures and scope boundaries that prevent unsupported claims about current Computer Use behavior."
reviewed_at: "2026-10-27"
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

## Field integrity qualification — 2026-10-27

Browser, AX and AT-SPI report per-field truncation within the existing 2,000-code-
point budget. Full-name digests bind references and query cursors; fresh reads
cannot rebind an old token to a renamed element. Oversized scalar attributes fail
explicitly, and closed read diagnostics survive Runtime and guest boundaries.
No page-specific readiness, JSON repair, scope substitution or input replay exists.
Default system prompt and three tool definitions are unchanged; shared core/read
help explains field budgets and scalar rejection.

Deterministic regressions first failed on missing flags, tail-only mutations and
fresh-observation reference rebinding. Final Chromium, Go normalization/guest/diff,
Swift and isolated Linux AT-SPI tests pass. Full computer execution qualification
passes 226 Node tests with one existing optional install skip; ten packaging/
browser/UI suites pass 314 tests without skips. Swift passes 36 tests; native
protocol, host safety, bundle staging, full ai/appserver packages and focused race
checks pass. Linux qualification includes Unicode boundaries, selector matching,
reference invalidation, private-display actions and object replacement.

Configured local DeepSeek V4.1 Flash (1017), wire deepseek-flash, completes the
final 46-scenario batch with 45 strict assertion passes (236 requests, 196 tool
activities, 35 errors including requested negatives). The native case fills the
exact value, clicks once and captures a screenshot after a model-authored pending
Promise is stopped. It fails the retained text-output assertion. Supplemental
canonical assertions across field integrity, natural Unicode reads and native
entry pass 8/9 (77 requests, 67 activities, six errors). All six field/text repeats
pass; native passes 2/3. The remaining native model hides snapshots with emit:false
and filters canonical nodes by an absent platform_role, yielding empty logs; exact
input, one click and screenshot are confirmed, text observation is not. No
production compatibility alias or special recovery is added for this model error.

Earlier 11/15 and 14/15 batches remain failed evidence: missing UTF-8 fixture
headers, dependence on model-authored log key names, and a numeric assertion that
rejected the correct formatted count 2,111. Fixtures/assertions were corrected;
original reports are retained. Missing build assets/catalog environment variables
were preflight failures, not provider successes. Credential/config hashes are
unchanged. These isolated tasks establish measured contracts, not universal model
reliability or proof of remote weights. No real user thread was continued.

## Generic contract qualification — 2026-10-27

Published Floret v7.88.0 owns batch exclusion; Redeven only declares its shared
computer-control group. Browser/native adapters no longer classify safety from
ordinary vocabulary. Unknown reads stop once; rendered text requires an HTML
element without fallback scope. Secure platform facts and permissions still pause.

Local DeepSeek V4.1 Flash (1017), wire deepseek-flash: the first 40 scenarios
passed. Eleven key scenarios repeated three times yielded 32/33 original assertion
passes; the remaining task recovered from an invented visual.screenshot call and
completed, but the first assertion incorrectly required zero guest errors. Nine
supplemental runs retain three Activity-vs-canonical assertion failures, one model
snapshot-vs-screenshot omission, and five passes. The final explicit mixed-batch
contract passed 3/3. Raw failures remain external; successful reruns do not erase
them. No production aliases or task-specific recovery were added for model errors.
Configuration and secret-file hashes remain unchanged. Tests use isolated browser
profiles, native fixture apps, project directories and task state; no real user
thread was continued. Provider responses prove the configured alias, not remote
weights. Deterministic contracts and model task completion are reported separately.
Browser/read contracts passed 223/224 with one existing opt-in extension-install
skip; the ten browser qualification suites passed. Go package, focused race,
macOS native and Linux private-display checks passed. One combined safety run
timed out waiting for a helper; the independent rerun and three consecutive
four-fixture runs passed. The original timeout remains in external evidence.

## Script batches, downloads and native entry — October 27

Source: task branch based on 95fec361bdc2f23b7c27712cb0576f5dfa9f6f18, Floret v7.87.5, FloeBrowser 0.1.28, native desktop 0.24.0, QuickJS 0.32.0, Playwright 1.63.0, Go 1.27.3/Node 26.7.0. Local DeepSeek V4.1 Flash (1017), wire deepseek-flash, uses read-only configured credentials; source config/secrets hashes remain unchanged. Isolated synthetic browser profiles and task-owned AppKit apps never continue real user conversations. Raw reports, failures and source hashes remain outside Git.

| Final qualification | Passed/attempted | Clean script calls by case |
| --- | ---: | ---: |
| Existing browser regression scenarios | 22/22 | Includes intentional rejection cases |
| Native installed-app entry, five repeats | 5/5 | 3/5 without script error |
| Browser export→file→CLI handoff, five repeats | 5/5 | 4/5 without script error |
| Multi-page script batch, five repeats | **4/5** | 1/5 without script error |

The final-clarity batch is **14/15**, 112 real provider requests, 98 tool activities and eleven error activities. Median durations: native 9,120 ms, mixed 12,028 ms, batch 11,622 ms. Batch repeat four reads all pages and computes 42 but model type misuse leads to separate per-page calls; it fails the unchanged requirement for ≥two page transitions in one invocation. Final prose does not substitute for tool evidence. This is limited acceptance, not universal reliability or a zero-error result. Existing regression uses 103 requests/81 activities/twelve errors.

Retain earlier final-core-v4 (batch/mixed each 5/5), final-delivery (native/mixed 5/5, batch 4/5 with DSML/final-answer defect), and final-tool-contract (batch 3/5, including an overstrict log-total assertion and real stale-ref misuse). Later assertions separate page/read/batch/screenshot facts from logged/final totals; old reports remain unchanged. Pilot failures include pre-provider fixture argument ordering and a reproduced NSWorkspace completion deadlock, both repaired. No repeat-until-green claim. Core help now states snapshot shape, document-bound refs and automatic image output.

Deterministic authored examples execute through real QuickJS→Runtime→browser/Chromium: 1,400,000-byte file matches byte-for-byte, one export/identity; three scores 7/14/21 sum to 42 in one batch with persistent globals/real screenshot. Source isolation passes 9/9 with same-name iframe/source downloads and cross-source rejection. First isolation failure was fixture URL shadowing, corrected to window.URL; no upstream workaround.

Final checks: complete ai/appserver Go suites (104.178/18.744s); focused race (7.409s); Node 179 pass, two explicit optional skips, zero fail; Swift 35/35; native entry single/no-window/multiple/minimized 4/4; native restoration, six safety checks, split/short JSONL and two relocated-package checks pass. Earlier restoration interrupted by external focus remains failed evidence. The initial Node command omitted installation configuration; the configured rerun passes.

A reproduced download-write regression now returns a failed save without marking the ready target stopped. Completion/content/source/cancel/revocation/local-IO cases validate per-chunk authorization, partial-file cleanup and no false path. App tests preserve launched facts through later authorization/selection failure. Runtime keeps existing permission/effect/interrupt owners; no Floret API/domain migration. Capture failures occurring before an upstream download ID remain uncorrelated and may timeout; do not guess identity from filename/time.

## Recovery/native facade — October 27

Local Flash: 22 managed-browser scenarios ×3 =66/66, 171.268s, 327 requests, median7,171.5ms; 210 successful/42 error activities include requested negatives/recovered misuse. Counters confirm no repeated save/click/export; config/secrets unchanged. Retain failed 19/22,65/66,64/66 with model/assertion defects distinguished.

Independent checks: browser313; execution142 plus one optional picker skip; Swift35. Real QuickJS/Go/Swift verifies two wheel events, offset200, screenshot and restored focus/pointer (external input invalidates restoration). Built Desktop/real Flash passes three native turns: clicks2→4, canvas double-click, text/Enter, wheel240, decoded720×582 images, live frames, canonical targets and provider images. Owned app/state/credentials/ports clean up. Linux, arbitrary AX and connected-Chrome real-model chain are not covered.

Exploratory runner fixes distinguish AX-only turns without saved preview, saved-image review from current subscription, and activity_summary target refs. Captures/current-run observation become explicit; failures stay failed. A later deterministic regression clears residual observation/attachments when uncertainty meets takeover; all script and ai tests pass (98.411s), final native run includes it. Base system/three entries unchanged; help clarifies scroll/read/budget/prefix, with no AXManualAccessibility or schema/API change.

Computer Stage initially has four runner failures; waiting finite Floe animations/lazy-preview disclosure yields11/11 with original geometry/image checks. ResizeObserver warnings remain; no production UI change/filter.

## Coordinates/explicit scripts — October 27

Service/Floret v7.87.4/Flash/Chromium153.0.8010.12 macOS arm64:19×3=57/57, median6,916ms;244 activities/34 errors (negative/recovered). Waits, safe diagnostics/reset and one save/click are canonical; config hashes unchanged. Not a general zero-error claim.

Real tabs.setZoom80/100/125/150/200/220%, scales1/2, offsets0/1500: decoded PNG/events cover semantic/image input, scrollbars, same/cross-process frames, nested scrollers, shadow roots and parent overlays. Snapshot450 nodes=27,478 bytes; full/detail retains data, truncation separately tested. Initial18/19 fixes malformed onclick fixture. Rejected retained-VM experiment could hold prior callback; final failed-namespace reset has isolation coverage.

System base/three entries unchanged; wording/help adds local/global lifetime/reset, exact waits, roles/images/compact output. No schema/API change. Managed-browser lane plus separate extension/native-messaging fixtures is not one built Desktop real-model chain; native foreground/Linux excluded.

## Compact surface — October 27

Source1140a827feb2d6acba7bc876337b93d4a698e99f, Service/Floret v7.87.3/local Flash/Chromium153.0.8010.12 macOS:15×3=45/45 in153.609s, median8,115ms. Source/runner/config/secrets hashes unchanged; isolated profiles.210 activities/28 errors:15 required negatives and13 additional model errors, recovered within tasks. Three image cases click once; three stale cases return STALE_REFERENCE/no clicks. One export/save each; strict timeouts prevent save; input/read/table totals/tab isolation/download identity pass.

Retain44/45 before immutable waiter,45/45 before canonical assertions,19/45 from ERROR-prefix parser and39/45 (four plain rejection parsing/two scroll interpretation failures). Final assertions separate plain pre-dispatch text from data.script_error and verify fixture effects; help demonstrates awaited node/scroll results. Source Node64/64 and ai87.654s pass. Exec definition4212→975 characters, not measured token/latency/success gain. No paired baseline; native, connected-Chrome, arbitrary sites and full Desktop UI excluded.

## Earlier platform records

2026-09-18: packaged extension installs in isolated real Chrome/macOS; Linux staging/reveal tests are deterministic, not GTK/Qt/portal picker acceptance. Iframe disappearance is reproduced between isolated-world creation and safety read without touching the user's Runtime. Built Desktop/Runtime, isolated headful Chromium, extension/Native Messaging and fake-model fixtures qualify repair only. Native receipts confirm clicks2→4, canvas double-click, text/Enter, scrolling, targets and screenshots; Linux runner checks owned container/port cleanup/config preservation. Background/foreground macOS passes after console unlock/explicit continuation; lock-screen use is unsupported.

[Performance](computer-use-performance.md) owns paired measurements/limits; they do not certify native desktop or Chrome-extension performance. Every lane is separate from exact-main pre-push qualification.
