---
type: Performance Qualification
title: Computer use paired model measurements
description: Compare visual primitives and semantic scripts through the production Service and report incomplete or failed evidence explicitly.
tags: [ai, computer-use, browser-use, performance]
timestamp: 2026-09-17T00:00:00Z
---
# Summary

Computer use performance is qualified through the production Flower Service,
published Floret, model adapter and managed browser. Paired fixtures measure the
same task with visual primitives and with semantic scripts available. The report
must retain failures and reject missing, duplicate or unmeasured samples.
Headless performance evidence does not establish native desktop or Chrome focus
behavior; those remain separate [acceptance requirements](computer-use-qualification.md).

# Contract

The runner uses the same configured DeepSeek provider and
`deepseek-v4-flash-vision-exp` model for both variants. Three repetitions cover a
form, a dynamically revealed form and an iframe form. Variant order alternates.
Each sample gets fresh application state, browser profile, thread and exact site
grant. Both variants receive the same task and model configuration; only the
semantic variant exposes `computer.observe` and `computer.exec`. Commands and
direct HTTP cannot satisfy the GUI task. The fixture verifies submitted values;
a model's assertion of completion alone cannot mark a run successful.

The runner records model requests, input image bytes, observation text bytes,
provider input tokens, host-operation count and time, action waiting, total time,
reported foreground operations and task success. Repeated history contributes
to model input costs on each actual request. Title generation is excluded.
Canonical fixture history is saved beside each sample for diagnosis. Credentials
are passed only to the child environment and upstream authorization header, never
to reports or logs.

Run explicitly with an existing configuration and an absolute evidence directory:

```sh
REDEVEN_COMPUTER_BENCHMARK=1 \
REDEVEN_COMPUTER_CONFIG_ROOT=/absolute/runtime/configuration \
REDEVEN_COMPUTER_EVIDENCE_DIR=/absolute/evidence \
node scripts/run_computer_benchmark.mjs
```

The configuration directory contains the product's `config.json` and
`secrets.json`. The runner reads them without changing them. Three repetitions
are the default; `REDEVEN_COMPUTER_BENCHMARK_REPETITIONS=1` is only a diagnostic
smoke run and cannot pass acceptance. `measurements.json` retains each sample;
`comparison.json` reports the aggregate and pass/fail decision.

Acceptance requires at least 40% fewer model requests, 70% fewer image bytes and
30% lower median task time, all samples successful with measured provider usage,
and zero reported foreground operations. A failed sample remains in the report;
reruns after implementation changes use a new evidence directory.

# Boundaries

Five complete three-repetition runs on 2026-09-17 retained the following results:

| Run | Requests reduced | Image bytes reduced | Median time reduced | Visual / semantic success | Accepted |
| --- | --- | --- | --- | --- | --- |
| 1 | 33.3% | 86.1% | 21.2% | 9/9 / 8/9 | No |
| 2 | 43.1% | 90.4% | 35.8% | 9/9 / 8/9 | No |
| 3 | 36.6% | 91.1% | 19.1% | 9/9 / 9/9 | No |
| 4 | 42.1% | 95.2% | 40.7% | 9/9 / 9/9 | Yes, managed-browser fixture scope |
| 5 | 46.2% | 92.7% | 41.9% | 9/9 / 9/9 | Yes, managed-browser fixture scope |

Run 1 missed a submission; return-shape and verification guidance followed.
Run 2 exposed a completed navigation incorrectly classified as private takeover.
The deterministic navigation-during-safety regression now discards the obsolete
observation while retaining confirmed action facts. Run 3 confirmed successful
execution, but extra model calls and invented script placeholders still missed
the efficiency targets. Complete API examples, batching guidance and invalidated
batch-result handling preceded run 4. Each changed implementation used a new
evidence directory; failed reports were retained. Run 4 reported zero foreground
operations. It does not qualify actual desktop or extension capability.

Run 5 follows the Codex design comparison, local-only observation option, bounded
AX output diffs, virtual-focus lifecycle and updated tool guidance. All 18
samples pass; visual and semantic variants use 106 and 57 model requests,
respectively. This is a fresh pair against visual primitives, not a controlled
comparison of run 4 and run 5; variation between those runs must not be attributed
solely to diffing. It reports zero foreground operations within the same narrow
managed-browser scope.

Observation token attribution is not exact: observation text bytes are measured,
while provider input tokens cover the whole request. Host waiting time excludes
model reasoning and transport. Headless operation counts do not measure actual
OS focus or pointer changes. This small fixture set cannot establish universal
speed or reliability across applications, models or network conditions.

# Evidence

- `redeven:internal/ai/computer_benchmark_test.go` - production Service fixtures and measurements.
- `redeven:scripts/run_computer_benchmark.mjs` - explicit credentialed runner and evidence output.
- `redeven:scripts/computer_benchmark_report.mjs` - paired completeness and threshold evaluation.
- `redeven:scripts/computer_benchmark_report.test.mjs` - failed, missing, duplicate and unmeasured samples.
