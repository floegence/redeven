---
type: Verification Evidence
title: Computer use qualification evidence
description: Read measured browser and desktop outcomes without conflating adapter, model and final integration scopes.
tags: [ai, computer-use, testing, evidence]
timestamp: 2026-09-17T00:00:00Z
lifecycle: retained_history
retention_reason: "Retains platform qualification failures and scope boundaries that prevent unsupported claims about current Computer Use behavior."
reviewed_at: "2026-10-22"
---
# Summary

The production qualification runners establish scope-specific outcomes under
[the acceptance contract](computer-use-qualification.md). The following results
were observed on 2026-09-17. A passing worktree run does not replace the exact-main
pre-push gate, certify arbitrary applications, or turn earlier failed runs into
successes. Private text and pixels are excluded from retained diagnostics.

# Contract

Keep measurements bound to their declared platform, provider and source build. Never infer cross-platform success from one adapter or from a model request returning HTTP 200.

# Boundaries

The source runners, not these aggregate counts, define pass/fail invariants.

See the acceptance contract for cleanup, evidence binding and scope restrictions.

# Evidence

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
