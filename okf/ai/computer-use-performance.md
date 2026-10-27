---
type: Performance Qualification
title: Computer use paired model measurements
description: Compare visual primitives and semantic scripts through the production Service and report incomplete or failed evidence explicitly.
tags: [ai, computer-use, browser-use, performance]
timestamp: 2026-10-13T00:00:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

Computer use performance is qualified through the production Flower Service,
published Floret, model adapter and managed browser. Paired fixtures measure the
same task with visual primitives and with semantic scripts available. The report
must retain failures and reject missing, duplicate or unmeasured samples.
Headless performance evidence does not establish native desktop or Chrome focus
behavior; those remain separate [acceptance requirements](computer-use-qualification.md).

# Contract

The runner uses the same configured DeepSeek provider and `deepseek-v4-flash-vision-exp` model for both variants. Commands and direct HTTP cannot satisfy the GUI task.

A failed sample remains in the report; reruns after implementation changes use a new evidence directory.

# Boundaries

## Schema version 2 qualification
On 2026-10-13, the first measured schema-v2 pair retained 18 samples with actual provider usage. The failed visual dynamic-form sample timed out while clicking Save and stopped with `floret_effect_outcome_unknown`; its action was never replayed.

Historical September results below do not qualify schema v2.

## Earlier qualification
Five complete three-repetition runs on 2026-09-17 retained the following results:

| Run | Requests reduced | Image bytes reduced | Median time reduced | Visual / semantic success | Accepted |
| --- | --- | --- | --- | --- | --- |
| 1 | 33.3% | 86.1% | 21.2% | 9/9 / 8/9 | No |
| 2 | 43.1% | 90.4% | 35.8% | 9/9 / 8/9 | No |
| 3 | 36.6% | 91.1% | 19.1% | 9/9 / 9/9 | No |
| 4 | 42.1% | 95.2% | 40.7% | 9/9 / 9/9 | Yes, managed-browser fixture scope |
| 5 | 46.2% | 92.7% | 41.9% | 9/9 / 9/9 | Yes, managed-browser fixture scope |

Run 1 missed a submission; return-shape and verification guidance followed.

It reports zero foreground operations within the same narrow managed-browser scope.

# Evidence

- `redeven:internal/ai/computer_benchmark_test.go` - production Service fixtures and measurements.

- `redeven:scripts/run_computer_benchmark.mjs` - explicit credentialed runner and evidence output.
