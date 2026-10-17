---
type: Validation Report
title: Flower persistent-index startup acceptance
description: Record isolated Floret v7.52.0 and complete product activation measurements on the 710 MB conversation fixture.
tags: [flower, startup, performance, storage, validation]
timestamp: 2026-10-17T00:00:00Z
---
# Summary

On the isolated 710,344,704-byte database with 219 threads, complete Redeven
construction plus activation reached a nearest-rank P95 of **9.429 seconds** over
20 sequential process runs. Published Floret v7.52.0 retained at most **261.052 MiB**
of GC-live heap; the entire product retained at most **295.018 MiB**. Both fixture
acceptance targets (P95 <=10 seconds and Floret idle heap <=350 MiB) passed.
These are dataset-specific measurements, not universal startup guarantees.

# Contract

## Method and provenance

The 2026-10-17 measurements used macOS 26.5.2 (25F84) on Apple M5 Pro, Go 1.27.2, and the
checksummed published `github.com/floegence/floret@v7.52.0`; no sibling wiring,
workspace override or live product store was used. The immutable old snapshot
was copied into isolated directories before migration. Each open measurement
ran in a new process. Percentiles use sorted sample ceil(0.95*n); all samples
are retained, including the slower first product run. Timings include full
canonical and prompt validation and finish before the first query.

The Floret runner measured ten processes per scenario. Migration started from
the old physical/logical format; first-index removed derived index facts in an
isolated current-format fixture. Reopen reused the completed index. Binary
upgrade changed probe binary identity without changing schema. Early migration
samples overlapped unrelated test/product preparation work; those numbers
describe observed first-build cost, not an uncontended speed claim. Complete
product acceptance ran sequentially after those workloads.

The product probe called the actual service constructor and `Activate`, with
background maintenance enabled. The fixture had no pending startup queues; the
probe checked that condition before activation to avoid external effects. GC
was requested after activation to measure retained heap. Sampled peak heap is
a separate metric and must never be reported as idle memory.

## Results

| Scenario | Processes | Median | P95 |
| --- | ---: | ---: | ---: |
| Migration plus index | 10 | 35.206 s | 39.500 s |
| First index on current canonical data | 10 | 33.956 s | 37.241 s |
| Ordinary Floret reopen | 10 | 6.407 s | 7.582 s |
| Changed binary, unchanged schema | 10 | 6.088 s | 6.425 s |
| Complete product preparation and activation | 20 | 7.852 s | 9.429 s |

Original observed product startup was 32.503 seconds, including 8.836 seconds
of duplicate inspection and 2.103 seconds of automatic full backup. Its earlier
isolated live-heap observation was approximately 1,076 MiB, with roughly 817 MB
attributed to the old index. That baseline is a prior observation, not a paired
20-process control. The new complete-product maximum was **10.977 seconds** in
the first sample. Acceptance is P95, not that every run is below 10 seconds.

Ordinary reopen, unchanged-schema binary upgrade and product startup emitted
**no indexing phase**, created **no automatic full backup**, and did not defer
index building until search. Six query terms (Chinese short text, SQLite,
flower, code punctuation and emoji) returned the same 137 total matches. The
largest single query observation was **7.737 ms**, including first searches.

Derived SQLite tables occupy **38,096,896 bytes (36.33 MiB)** plus 24,844 bytes
of KV manifest payload. Existing free pages absorbed this growth, leaving the
fixture file at 710,344,704 bytes; this is page reuse, not zero index cost.
Sampled startup peak heap across scenarios reached approximately **1,015 MiB**. Canonical
validation still creates substantial temporary allocation; that peak remains
a known cost even though idle-memory and ordinary-startup targets pass.

Twenty isolated operations per type measured thread creation, title updates
and queued-input append. These are absolute product costs, not a paired
old/new write-amplification comparison. Queue append is not canonical message
admission. Its checkpoint outlier was 33.021 ms and remains in the sample.

| Operation | Median | P95 | Maximum |
| --- | ---: | ---: | ---: |
| Thread creation | 0.389 ms | 1.004 ms | 3.278 ms |
| Title update | 0.198 ms | 0.285 ms | 0.287 ms |
| Queued-input append | 0.294 ms | 1.019 ms | 33.021 ms |

## Retained timing samples

Durations below are seconds in execution order. No observation was discarded.

| Sample | Migration | First index | Reopen | Binary upgrade |
| --- | ---: | ---: | ---: | ---: |
| 1 | 35.595 | 35.624 | 6.857 | 6.205 |
| 2 | 35.124 | 32.561 | 6.814 | 6.260 |
| 3 | 35.396 | 35.387 | 6.145 | 6.043 |
| 4 | 34.905 | 35.027 | 6.211 | 6.153 |
| 5 | 31.666 | 32.692 | 6.289 | 6.002 |
| 6 | 31.692 | 37.241 | 6.142 | 6.040 |
| 7 | 35.742 | 34.094 | 6.124 | 6.002 |
| 8 | 39.500 | 31.819 | 6.654 | 6.425 |
| 9 | 34.870 | 31.350 | 6.525 | 6.132 |
| 10 | 35.287 | 33.818 | 7.582 | 6.039 |

Product activation samples (1-20), in seconds: 10.977, 8.082, 7.946, 7.898, 7.743, 7.793, 7.787, 7.801, 7.761, 7.738, 7.805, 7.759, 7.757, 7.794, 9.032, 9.429, 8.633, 8.593, 8.925, 9.033.

## Validation and delivery

Floret ran its complete Go suite, focused query/persistence/migration/startup
race checks, v7.16.2 API compatibility, candidate adoption and actual published
module adoption. v7.52.0 contains cbad47d (transactional indexes), acad18a
(completed-work progress), and 5be01b8 (cancelled SQLite rollback ownership).

Redeven's affected-package, controller race, restore interruption, Env App
browser, Desktop readiness, types, localization, build, wire-schema and
dependency-boundary checks are the acceptance surfaces. The task explicitly
excludes Redeven push and its push gate. See [readiness ownership](../architecture/ai-readiness-lifecycle.md),
[startup interaction](../architecture/flower-startup-presentation.md), and
[snapshot recovery](../ai/flower-backup-and-recovery.md).

# Boundaries

The probe never skipped canonical verification, changed production records,
replayed uncertain tool effects or created another product index. First-build
interruption rolls back and requires explicit retry. Product tests preserve
approval, queue, media-inventory and restore-generation boundaries.

# Evidence

- `redeven:internal/ai/service_activation.go:1` - Summary/inventory preparation and explicit activation.
- `redeven:internal/codeapp/ai_readiness_test.go:1` - Serialized stop, cleanup, retry and terminal close failure.
- `redeven:internal/ai/storage_upgrade_test.go:1` - Replacement interruption and preserved datasets.
- `redeven:go.mod:1` - Published dependency and toolchain authority.
