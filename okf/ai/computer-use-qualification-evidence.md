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

## Recovery contracts and native facade, October 27

The recovery repair qualifies the local DeepSeek V4.1 Flash (1017) profile, wire
model deepseek-flash, against 22 isolated managed-browser scenarios repeated
three times: 66/66 pass in 171.268 seconds, with 327 real provider requests.
Median case time is 7,171.5 ms. Canonical computer activities include 210 success
and 42 error statuses, including prescribed negative cases and recovered model
misuse. Fixture counters verify no replayed save, click or export. This is not
a zero-error or general success-rate claim. Earlier 19/22, 65/66 and 64/66
batches remain failed evidence, with model-instruction and assertion defects
classified separately. Source configuration and secrets remain hash-identical.

Independent browser qualification passes 313 checks; the execution matrix
passes 142 checks with one explicit optional installation-picker skip. Swift
passes 35 tests. A real QuickJS-to-Go-to-Swift AppKit fixture verifies default
and coordinate scrolling, two wheel events, offset 200, screenshot and restored
focus/pointer. External desktop input invalidates restoration measurements.

Built Desktop with the real configured Flash provider also passes three native
turns: exact click counts 2 then 4, double-click, text/Enter, wheel offset 240,
decoded 720-by-582 screenshots, continuous workspace frames, canonical target
references and provider image output. The runner verifies unchanged source
state, credential removal and port release. This scope uses a disposable AppKit
application, not the user's production applications. It does not qualify Linux,
arbitrary AX coverage or one real-model connected-Chrome end-to-end chain.

Exploratory Desktop runs exposed outdated runner assumptions: an AX-only turn
without a saved capture has no historical preview; a saved-image review does
not prove a current live subscription; canonical activity target references
now live in activity_summary. Qualification explicitly requests its captures,
waits for current-run observation and reads current summary facts. Frame and
effect assertions remain strict. Failed runs are not relabeled as successes.

After the 66-case batch, a deterministic failing regression identified residual
observation content when unknown effect and takeover coincide. The final
cleanup clears that content and attachments; all script regressions and the
complete internal/ai suite pass (98.411 seconds). The final native run includes
this repair. Shared base system prompts and the three default entry points are
unchanged; tool/help text adds exact scrolling, bounded reads, budget guidance
and safe prefix output. No AXManualAccessibility override, domain migration or
Floret public API change is introduced. Final rebased integration is separate.

The additional Computer Stage browser suite reproduces four runner failures.
Release-boundary assertions now await Floe's finite animations; screenshot
checks expose the lazy preview and await disclosure completion. All 11 tests
pass with the original geometry and image assertions. ResizeObserver loop
warnings remain in the retained browser log; no production UI change or error
filter is introduced by these runner corrections.

## Browser coordinates and explicit script contracts, October 27

The contract repair qualifies the production Service, Floret v7.87.4, local
DeepSeek V4.1 Flash (1017) profile (wire deepseek-flash), and catalog-installed
Chromium 153.0.8010.12 on macOS arm64. Nineteen scenarios repeated three times
pass 57/57. Median case time is 6,916 ms; 244 tool activities include 34
error-status activities, including intentional negative cases and recovered
model-call errors. Completion is not a zero-error or general success-rate claim.
Canonical results verify strict content waits, safe source diagnostics and
namespace reset; fixture counters verify one save/click without replay.
Configuration hashes remain unchanged and every case uses task-owned state.

A deterministic browser matrix uses real chrome.tabs.setZoom at 80, 100, 125,
150, 200 and 220 percent, device scales 1/2 and page offsets 0/1500. Decoded PNG
pixels and counted events verify image and semantic input, including scrollbars,
same-process/cross-process frames, nested scrollers, shadow roots and parent
overlays. This supplements the earlier emulated-scale evidence. A 450-node
compact snapshot fits in 27,478 bytes; full guest/detail reads retain their
canonical data. Truncation and detail-mode changes have separate regression tests.

The initial exploratory batch passes 18/19 before a malformed synthetic onclick
fixture is corrected. Its temporary VM-retention design is rejected: a dormant
Promise could retain a prior invocation callback. The final design resets every
failed namespace and has a dedicated isolation regression. Earlier reports are
not relabeled as final qualification.

Shared base system prompt content remains unchanged. The three default entry
points remain targets, select_target and exec. Changes are in exec wording and
the shared selection/runtime help: local/global variable lifetime, failure reset,
exact browser text/value waits, canonical roles, image capture/input and compact
versus detailed observations. No storage migration or Floret API changes occur.
The real-provider lane qualifies managed Chromium. Separate real extension and
Native Messaging fixtures do not constitute one built Desktop/Service/extension
end-to-end real-model run. Native foreground and Linux desktop are outside it.

## Compact script surface, October 27
Source commit 1140a827feb2d6acba7bc876337b93d4a698e99f qualifies the production
Service, Floret v7.87.3, the local DeepSeek V4.1 Flash (1017) profile (wire model
deepseek-flash), and catalog-installed Chromium 153.0.8010.12 on macOS arm64.
All 15 scenarios repeated three times pass: 45/45 in 153.609 seconds, with a
median scenario duration of 8,115 ms. Implementation and runner file hashes
remain unchanged during this batch. Source configuration and secrets are
hash-checked before and after; only isolated fixture browser profiles are used.

The 210 tool activities include 28 error-status activities: 15 requested negative
boundary rejections and 13 additional model-call errors. The model recovers
within the qualified tasks. All three image-input cases dispatch one click;
all three stale-image cases return canonical STALE_REFERENCE with zero clicks.
Each download is exported once; each partial-effect case saves once; strict
timeouts prevent the following save. Natural input/read, complete loaded-table
totals, task-tab isolation and current-download identity pass. This is not a
zero-error result or a general model success-rate estimate.

Retained exploratory batches include 44/45 before the immutable download waiter,
45/45 before canonical-result assertions, and 19/45 when the new parser rejected
Floret's ERROR prefix. A subsequent 39/45 batch exposes four plain pre-dispatch
rejection parsing failures and two scroll-result interpretation failures. The
final runner preserves plain runtime rejection text separately, never uses it
as script diagnostic proof, and checks canonical data.script_error plus fixture
effects. Core help now demonstrates awaited node reads and scroll return values.
These earlier reports remain failures; final results do not rewrite them.

The rebased source also passes all 64 selected script/browser/navigation Node
tests and the complete internal/ai Go suite (87.654 seconds). Shared base system
prompt bytes remain unchanged. Default computer discovery has three entry
points, and the exec definition shrinks from 4,212 to 975 characters; signature
details move to shared selection/help responses. This is a character count, not
a measured token, latency or success-rate improvement.

The real-provider lane mixes natural tasks with prescribed diagnostic scripts.
It does not certify native desktop applications, connected Chrome/extension
transport, arbitrary sites, or the complete built Desktop UI. No paired
performance baseline was measured. The exact-tip integration gate is separate.

## Visible installation folders
The 2026-09-18 guide refinement installed the packaged extension in an isolated real Google Chrome profile on macOS. Linux staging and fixed reveal commands pass deterministic tests on the current host; Linux native GTK, Qt and portal pickers were not exercised on this macOS machine.

## Observation recovery
The 2026-09-18 observation repair reproduced a normal page losing an iframe between isolated-world creation and its safety read. The user's Runtime and pending interaction were untouched.

## System-browser and control repair
The 2026-09-18 repair qualification uses task-owned built Desktop and Runtime, an isolated headful Chromium profile, the production extension and Native Messaging, and deterministic model responses. These fixtures supplement the historical evidence below; they do not replace the exact-main push gate or qualify arbitrary sites and applications.

## Real model product flows
Native Desktop confirms exact click counts of 2 then 4, canvas double-click, text/Enter, wheel scrolling, canonical target references and final screenshots. The Linux runner separately verifies container and port removal and unchanged source configuration.

## Native and private fixture results
After console unlock and explicit continuation, macOS background and foreground fixtures pass. Lock-screen operation remains unsupported.

## Performance scope
[Paired measurements](computer-use-performance.md) own the complete benchmark series, thresholds and measurement limits. These measurements do not establish native desktop or Chrome extension performance.
