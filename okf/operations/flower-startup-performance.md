---
type: Validation Report
title: Flower persistent-index startup acceptance
tags: [flower, startup, performance, storage, validation]
lifecycle: active_evidence
reviewed_at: "2026-10-22"
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
The 2026-10-17 measurements used macOS 26.5.2 (25F84) on Apple M5 Pro, Go 1.27.2, and the checksummed published `github.com/floegence/floret@v7.52.0`; no sibling wiring, workspace override or live product store was used. Timings include full canonical and prompt validation and finish before the first query.

Sampled peak heap is a separate metric and must never be reported as idle memory.

## Results
| Scenario | Processes | Median | P95 |
| --- | ---: | ---: | ---: |
| Migration plus index | 10 | 35.206 s | 39.500 s |
| First index on current canonical data | 10 | 33.956 s | 37.241 s |
| Ordinary Floret reopen | 10 | 6.407 s | 7.582 s |
| Changed binary, unchanged schema | 10 | 6.088 s | 6.425 s |
| Complete product preparation and activation | 20 | 7.852 s | 9.429 s |

Canonical validation still creates substantial temporary allocation; that peak remains a known cost even though idle-memory and ordinary-startup targets pass.

| Operation | Median | P95 | Maximum |
| --- | ---: | ---: | ---: |
| Thread creation | 0.389 ms | 1.004 ms | 3.278 ms |
| Title update | 0.198 ms | 0.285 ms | 0.287 ms |
| Queued-input append | 0.294 ms | 1.019 ms | 33.021 ms |

## Retained timing samples
Durations below are seconds in execution order.

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

## Validation and delivery
Floret ran its complete Go suite, focused query/persistence/migration/startup race checks, v7.16.2 API compatibility, candidate adoption and actual published module adoption. v7.52.0 contains cbad47d (transactional indexes), acad18a (completed-work progress), and 5be01b8 (cancelled SQLite rollback ownership).

See [readiness ownership](../architecture/ai-readiness-lifecycle.md), [startup interaction](../architecture/flower-startup-presentation.md), and [snapshot recovery](../ai/flower-backup-and-recovery.md).

# Boundaries

The probe never skipped canonical verification, changed production records, replayed uncertain tool effects or created another product index. Product tests preserve approval, queue, media-inventory and restore-generation boundaries.

# Evidence

- `redeven:internal/ai/service_activation.go:1` - Summary/inventory preparation and explicit activation.

- `redeven:internal/codeapp/ai_readiness_test.go:1` - Serialized stop, cleanup, retry and terminal close failure.
