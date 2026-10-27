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
