---
type: Acceptance Contract
title: Computer use product qualification
tags: [ai, computer-use, desktop, testing]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Redeven qualifies Computer use through the actual product renderer, Runtime,
media decoder and target adapter. A passing scenario proves only its declared
target and provider scope. Fixture outcomes, decoded pixels and cleanup are
required evidence; successful HTTP responses or tool metadata alone are
insufficient. Failed input and uncertain effects must never be replayed to
manufacture a passing result.

# Contract

## Evidence and isolation
Use built product renderer, Runtime, decoder and adapter. Keep canonical results, fixture events, decoded frames, exact source/artifact hashes and cleanup. HTTP/code/model prose/Activity alone prove neither effects nor pixels. Separate assertion, model and product failures, retaining originals; never replay uncertain input or repeat until green. Native/provider/foreground suites remain explicit outside ordinary/exact-main gates.

Result-encoding recovery uses a real task Service/public UI: one counted effect followed by invalid optional result. Browser/native semantics share cancellation/revocation-before-input and terminal unknown acknowledgements.

## DeepSeek lane
TestComputerReliabilityDeepSeek uses production Service/Floret, configured deepseek-flash (local V4.1 Flash 1017) and catalog-installed Chromium, without substitutes. Require REDEVEN_COMPUTER_RELIABILITY_E2E=1, absolute REDEVEN_COMPUTER_CONFIG_ROOT/EVIDENCE_DIR and REDEVEN_BROWSER_TEST_INSTALLATION. Command: GOWORK=off go test ./internal/ai -run '^TestComputerReliabilityDeepSeek$' -count=1 -v -timeout=22m. Repetitions 1..5 (default 1); browser-only may use -parallel 3. Native requires REDEVEN_COMPUTER_NATIVE_E2E=1 and released Swift helper, serialized desktop access; absolute REDEVEN_COMPUTER_NATIVE_TEST_HOST may select a baseline. Preserve provider/secret hashes and user threads.

Use default tools except explicit legacy-wait case. Cover bounded text/limits/budgets, confirmed prefixes, pre-focus validation, paging, image identity, delays/titles/staleness/options, scroll facts, conditions/natural tasks, timeout/below-fold input, exact asynchronous content, landmarks/reset, scripts/downloads/app entry. Canonical ThreadToolResultReader must decode Floret ERROR and host envelope. Require data.script_error for script diagnostics; pre-dispatch rejection is distinct. Final prose/logs cannot replace execution. Completed waits remain confirmed after guest failure.

| Case | Required effects/evidence |
| --- | --- |
| capture/refs | Four PageDown then fresh screenshot; parent ref survives child navigation |
| options/waits | Exact unsupported field, failed index and safe condition facts |
| stale/image | STALE_REFERENCE and zero pointers / one pointer after image |
| visual/form/table | Vary position/labels/size; screenshot before actual visual click; exact values/totals |
| batch | Three page reads, >=two transitions in one script, screenshot; totals checked separately |
| download | One export/save identity, exact bytes and terminal-created project file; no anonymous reads after acquisition |
| native entry | Discovery/confirmed selection, exact text, one click/screenshot |
| optional/caught | Zero/timeout may branch; failed unique lookup cannot resume input even when caught |
| observed roles | Search-purpose controls with different observed roles; exact three values and one submit |
| evaluation error | One injected execution failure retains method/reason/prefix; zero later input, fresh screenshot |
| output loss | Prior explicit output retained; one fault/zero later input; actual method without invented code |
| host rejection | Real empty helper rejects before controller dispatch; canonical non-execution and prior text survive, with zero later input |
| drag | Independent press/release/moves/endpoints/duration; invalid integer_0_5000 rejects before input |
| observation lifetime | Complete content/image/metadata/safety through cleanup; child-frame waits, fixed refs, privacy, cancellation and unknown faults |
| dynamic content | Natural and explicit waits, same-document SPA updates, shadow form and continuously updating unrelated content |
| public reads | MDN, Wikipedia and GitHub title/heading/screenshot; actual adapter evidence even with emit:false; reject forbidden non-Computer tools |

Also cover >2,800 nodes, complete totals, account/tab separation, older same-name download and save followed by diagnostic failure without replay. Retain wire IDs/errors/history/events/answers. Scope success proves neither weights nor universal reliability.

## Browser/native boundaries
Semantic scroll verifies document/tall/clipped/covered cases, counting wheels separately from scroll preparation: one valid dispatch, zero on rejection. Real extension CDP/AX faults retain method/code, zero input and explicit same-ref recovery. Managed frames/shadows/transforms and malformed reads use actual zoom/DPR.

Maintained batch/download examples run QuickJS→Runtime→Chromium with exact multichunk bytes/one export/ID, page values and screenshot. Native entry verifies zero/one/multiple/minimized windows; native script checks actual Swift scrolling/screenshots/focus restoration, invalidated by external input.

AppKit drag receiver verifies 0/1/500/5000 ms plus interrupted 5000 ms, one press/release and early canceled endpoint, using independent timestamps. Fixture key-window changes require factual pause/balanced release/explicit recovery, never replay. Real-model timed/invalid/zero/focus-change cases use production receipts. Browser node tests cover both hosts/image/timing/cancellation but cannot qualify native timing.

## Product carriers
Built Desktop uses isolated exact provider config and rejects missing/overridden identity. Observe preload workspace stream; Linux Webtop may passively copy CDP. Missing decoded native/browser frame fails that scope. Name all unqualified platforms/native/connected-Chrome lanes.

checkDesktopSystemBrowser.mjs combines built Desktop/Runtime/extension/Native Messaging with deterministic provider: canonical help before target binding, then continuation after verified connection. Existing media/takeover owns private previews. Delete owned fixture threads/servers and exact process trees; verify ports. Late decoding, expired interactions, queued input, selection and close remain separate deterministic boundaries.

# Boundaries

This contract grants no target authority and does not replace [media](computer-use-media.md) or [takeover](computer-use-takeover.md). Native disposable-app results do not qualify arbitrary applications/accounts. Freeze source hashes and rerun affected checks after integration; fixture scope never substitutes for the exact-main gate.

# Evidence

Historical provider runs and their original failures are retained in
[provider qualification evidence](computer-use-provider-evidence.md).

November 3, factual receipt qualification: 395 browser Node checks, 288 Flower
presentation checks and 28 browser-rendered lifecycle checks pass. Native Messaging
and catalog-installed browser sandbox/example lanes pass separately; the Chrome
installation-picker lane remains opt-in. Affected Go packages, UI build/typecheck,
changed-script lint and OKF integrity pass. Ten new browser fixtures cover exact
scroll measurement, delivery/observation separation, reduced duplicate scans,
wait timing, declared actions, original href and table-cell source reachability.

The updated product at 97660d396 completes a real configured-DeepSeek Search
Console task using a connected background tab: six resource/report pairs, 37
computer.exec calls, 32 successes and five observation interruptions. This first
run is retained as a failed reliability baseline, not a clean qualification.
A subsequent bounded diagnostic observes TypeError in URL construction for an
initial child frame whose Page.getFrameTree URL is empty. Local inspection records
only URL type/length, frame keys and call sites, never page contents. Four isolated
regressions reproduce the empty-metadata boundary and verify actual-document URL
resolution, private input, ungranted origin and invalid URL rejection. They pass
with the 73 surrounding read/privacy/lifecycle checks. A new product run is required
to certify the corrected build; prior old-thread root causes remain unproven.


The next real connected-Chrome task at 26f8a1f88 completes eight resource/report
pairs with 25 computer.exec calls: 18 successes and seven observation
interruptions. None retains adapter/safety_scan/internal_error; one identifies
Page.createIsolatedWorld protocol rejection and the others report read/capture
lifetime interruption. The built renderer shows neutral confirmed-action copy.
This is not a zero-interruption pass: an explicit wait could stop in frame/safety
preparation before entering its own sampling loop. Three failing deterministic
regressions reproduce that boundary; four real Chromium fixtures verify child
replacement and transient privacy evidence during entry. Preparation now shares
the caller's wait deadline without resetting privacy state; only typed lifecycle
evidence permits another sample. Unknown protocol failures still stop once.


Final product run at 05ae7a650 (after preserving concurrent Gateway integration)
reads six Search Console resource/report pairs in a new background tab through
configured DeepSeek and the installed Chrome extension. Its first turn has 18
computer.exec calls: 14 success, two observation interruptions, one SCRIPT_FAILED
from treating text() as a string, and one rejected stale ref. Four explicit waits
use mismatched text-role conditions and correctly return timeout with 33–66
samples; successful following text reads do not invalidate those results. The
model also reads nonexistent snapshot.tree despite help defining nodes, and
mistakes a main-only read for absence of the page's update label. A scoped
follow-up observes that label and a unique heading; matching that heading returns
visible in 320 ms. The separately specified one-call navigate/wait/text regression
then passes once: visible after two samples/419 ms, complete selected text, 2,434
ms total tool activity. These follow-ups do not replace the initial failures or
prove every read succeeds; one remaining wait interruption has no sufficient
stage detail to claim its exact root cause. No website-specific waits, input
replay, hidden retries or forged success are introduced.

Final source checks: 407 Node passes/two existing opt-in skips, three additional
permission/cancellation/connection checks, catalog-managed sandbox and script
examples, and 73 affected checks after rebase pass. Initial affected Go suites,
288 presentation tests, 28 browser-rendered UI checks, build/typecheck, Native
Messaging and lint also pass. Only generated knowledge artifacts conflict during
rebase and are rebuilt from both source sets. User-directed local delivery omits
Redeven push and its push gate; it does not claim remote synchronization. Account
contents, exact activity evidence and earlier failures remain private outside Git.
