---
type: Verification Evidence
title: Computer use qualification evidence
tags: [ai, computer-use, testing, evidence]
lifecycle: retained_history
retention_reason: "Retains platform qualification failures and scope boundaries that prevent unsupported claims about current Computer Use behavior."
reviewed_at: "2026-11-02"
---
# Summary

The production qualification runners establish scope-specific outcomes under
[the acceptance contract](computer-use-qualification.md). The following results
include September through November 2026 runs. A passing worktree run does not replace the exact-main
pre-push gate, certify arbitrary applications, or turn earlier failed runs into
successes. Private text and pixels are excluded from retained diagnostics.

# Contract

Keep measurements bound to their declared platform, provider and source build. Never infer cross-platform success from one adapter or from a model request returning HTTP 200.

# Boundaries

The source runners, not these aggregate counts, define pass/fail invariants.

See the acceptance contract for cleanup, evidence binding and scope restrictions.

# Evidence

All live-model lanes use configured deepseek-flash (local V4.1 Flash 1017), which does not prove remote weights. Source credentials/configuration and personal threads remain unchanged. Exact raw reports/source/tool identities are retained outside Git; full historical tables remain in this file's Git history. Task success is not zero model errors or cross-platform reliability.

## November 2
Semantic condition waits revalidate temporary query candidates without changing
the query, deadline or fixed scope; ordinary reads/input and stale refs do not
retry. Consumed DOMSnapshot fields retain bounded adapter diagnostics. The
deterministic reproduction fails 6/10 before repair; expanded contract coverage
passes 19/19. Browser suites pass 355 with one optional installation skip; Go
passes 404 with eight opt-in skips, plus focused race, helper staging and script
examples. No native-platform expansion is claimed.

Real DeepSeek Flash 1017 qualification covers 22 task types twice. The development
run remains 42/44 (311 requests); the final production-source run is 39/44 (281
requests), with both semantic-wait and injected-invalid-result repetitions passing.
Failures retain two model argument/locator errors, one MDN network timeout, one
public-task prompt/assertion mismatch (Home was not expressly prohibited), and one
long-text task where the model read a text-node prefix instead of the documented
HTML-element text read, then requested input until the runner deadline. The public
prompt now expressly disallows keyboard/pointer input, matching its existing
assertion; the public supplement passes 6/6 (31 requests) on unchanged production
sources. Supplemental runs remain separate and never rewrite earlier results.
A final scope review reproduces two further sampling gaps: the same candidate
moves outside root_ref or a second match appears during the state read. Reusing
original-query resolution at sample completion fixes both; focused coverage is
21/21. A separate rebuilt 22-type, two-round release run passes 43/44 (278
requests), including both new repair lanes and all six public tasks. frame_refs/1
changes the instructed single-call diagnostic, reads a replaced child and fails
ELEMENT_NOT_FOUND; the same parent ref subsequently saves once. Preserve this
failed contract attempt; no input replay or silent target substitution occurred.
No site-specific production rule, input replay or relaxed boundary was introduced.

## October 29
Four real Service/persistence/FlowerSurface fixture workflows qualify autonomous continuation after result loss, explicit question/retry, question cancel and offline observation. Each counts one effect through reload/restart, never replay. Offline is unobserved, not verified. Script suite passes 67 including stalled Promise after one click. These are adapter facts, not model-decision evidence. Old questions remain answerable/cancelable, never auto-answered. Sources: [UI](../../internal/ai/computer_result_ui_test.go), [tool contract](../../internal/ai/tool_design_contract_test.go), [history](../../internal/ai/tool_design_history_test.go).

## October 28
Scroll original 29/36 includes three mistaken no-movement expectations and four model errors. Corrected 20/24 retains positional-scroll misuse, undefined variable and two multipage errors. Six valid document/tall/clipped cases dispatch one wheel; covered input dispatches zero and retains preparation_executed. Other covered failure precedes adapter. Read/stale-name/visual/form/table/download scopes pass twice without aliases/replay. [Media](computer-media-read-qualification.md) and [drag](computer-drag-qualification.md) retain their separate failures/measurements.

## October 27
Field integrity fails before repair, then passes full-name/2,000-code-point flags across browser/Go/Swift/AT-SPI. Node 226/one optional skip, ten suites 314, Swift 36 and Go/race/staging pass. Model 45/46 (236 requests) fails native text observation despite correct fill/click/image; supplemental 8/9 (77 requests) retains absent platform_role/suppressed-snapshot failure. Earlier 11/15 and 14/15 include UTF-8/log-key/number fixture defects; missing assets/config are preflight failures.

Generic contracts use Floret 7.88.0. First 40 tasks pass; 32/33 original assertions retain invented visual.screenshot followed by success but failed zero-error assertion. Nine supplements retain three Activity-vs-canonical defects, omitted screenshot and five passes; explicit mixed-batch 3/3 passes. Browser 223/224 includes optional install skip. Combined helper timeout remains failed despite independent and three repeated four-fixture passes. No model-specific recovery.

Script-entry baseline 95fec361bdc2/Floret 7.87.5/FloeBrowser 0.1.28/native 0.24.0: browser 22/22, native 5/5 (three clean), download 5/5 (four clean), batch 4/5 (one clean). Final-clarity 14/15 uses 112 requests/98 activities/11 errors; failure totals correctly but omits two transitions in one call. Preserve core-v4 batch/mixed 5/5, final native/mixed 5/5 and batch 4/5 DSML/final failure, contract batch 3/5 with totals/stale-ref defects. Pilot ordering/NSWorkspace deadlock repaired; never overwrite failures.

Maintained examples prove 1,400,000 exact bytes/one export and 7+14+21=42 in one script with globals/screenshot. Source isolation 9/9 after window.URL fixture repair; Go/race, Node 179/two optional skips, Swift 35 and four native window cases pass. Earlier external-focus restoration fails. Download failures clean partial bytes without false saved paths; missing upstream IDs may timeout, never guessed by filename/time.

Earlier facade lane: 66/66 over three rounds, 327 requests, 210 success/42 negative/recovered errors; retain 19/22, 65/66, 64/66. Browser 313, execution 142/optional skip, Swift 35. Real native script gives two wheels/200 offset/screenshot; external input invalidates restoration. Built Desktop completes three native model turns, decoded 720×582 frames and exact click/text/wheel receipts. Stage first fails four; corrected animation/preview waits pass 11 without relaxed image/geometry checks; ResizeObserver warnings retained. No arbitrary AX/Linux/connected-Chrome claim.

Coordinates lane (7.87.4): 57/57, 244 activities/34 negative/recovered errors; actual zoom 80–220%, scales 1/2 and offsets 0/1500. Initial 18/19 fixes malformed fixture onclick. Retained-VM experiment rejected for live callbacks; failure retires namespace. Native foreground/Linux/combined Desktop model chain excluded.

Compact lane (1140a827feb2/7.87.3): 45/45, 210 activities/28 errors (15 required, 13 recovered). One image click/export/save, stale rejection and timeout hold. Keep original 44/45, pre-canonical 45/45, parser 19/45 and interpretation 39/45 separately. Definition shrink 4,212→975 characters proves no measured token/latency improvement.

## Platform limits
September 18 isolated Chrome/macOS extension installation is separate from Linux deterministic staging and OS-picker proof. Built Desktop/Runtime/extension/Native Messaging fake-model lane reproduces and fixes iframe loss. Native effects/frames and Linux cleanup preserve user configuration. macOS requires unlocked console. [Performance](computer-use-performance.md) owns paired measurements; no evidence here replaces exact-main qualification.
