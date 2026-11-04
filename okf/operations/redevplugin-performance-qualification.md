---
type: Validation Report
title: ReDevPlugin 3.15 performance qualification
tags: [plugins, performance, runtime, validation]
lifecycle: active_evidence
reviewed_at: "2026-11-04"
---
# Summary

ReDevPlugin 3.15.0 improves measured warm execution and Redeven restores only
initially visible plugin placements. Opened surfaces retain their independent
slots, drafts, selection and pending work when hidden. This is conditional lazy
opening, not a concurrency cap or iframe reuse. Platform mechanisms and release
ownership remain in [the host boundary](../architecture/redevplugin-boundary.md).

# Contract

Consume the coordinated published Go/npm/Rust release, without local overrides.
Rust 1.98.0 builds the Wasmtime 50 runtime. The macOS helper keeps hardened
runtime with exactly the executable-memory exception required by upstream;
staging, cache identity and consumption verify the actual signed entitlement.
The executable is product-built; source-package provenance is not product
signing evidence. Release signing still requires the product identity.

Each first open captures current context/revision. Unopened close succeeds and
prevents later opening. Visibility never cancels an already started invocation,
replays an uncertain write or reuses revoked authority. Ordinary Worker errors
remain application-owned; they do not destroy a Surface. See
[recovery](../architecture/redevplugin-surface-recovery.md).

# Measurement

November 3, 2026, macOS/arm64, Node 26.7.0, Go 1.27.3 and Rust 1.98.0. Redeven
baseline is 2433435341c55aa34013de78c1ab023277d96639. Both UI variants use published
ReDevPlugin 3.15.0/Floe 0.87.2 and the same production Integration HTTP server,
including durable Host state. The old component alone is substituted in the
test build. Fifteen alternating fresh-browser pairs per scenario produce 60
trials; paired ratios use 10,000 deterministic bootstrap resamples.

| Scenario | Baseline median | Candidate median | Interpretation |
| --- | ---: | ---: | --- |
| One visible placement, active ready | 132.4 ms | 57.5 ms | Paired 2.315x, 95% interval 2.167–2.371 |
| One visible, incremental process-tree RSS | 867.59 MiB | 105.86 MiB | 87.8% less; ten frames versus one |
| First deferred activation | 0.1 ms | 49.1 ms | Candidate P95 53.99 ms; explicit first-use cost |
| Ten visible, all ready | 134.3 ms | 133.8 ms | No material regression; ten independent frames |
| Fresh Worker process/state, total | 335.68 ms | 504.05 ms | +168.37 ms; below predeclared 1 s echo budget |
| First Worker call | 6.05 ms | 4.39 ms | Excludes setup |
| 64 KV writes, individual versus batch | 225.5 ms | 4.55 ms | Paired 50.34x; exact values and rollback |
| Six schema statements, individual versus transaction | 48.15 ms | 8.15 ms | Paired 5.63x; trigger behavior retained |

Cold results use fifteen alternating pairs with identical historical 3.14 echo
guest bytes, fresh Integration/process/plugin state and warm OS file cache.
Candidate install/grant/prewarm is 186.86 ms versus 78.49 ms. Current 3.15 author
output also passes a separate live hardened-runtime smoke. These are not heavy
editor startup or network SLAs. Batch figures compare existing transports under
3.15, not a claim that every plugin becomes 50x faster. The six-statement case
does not measure complete Memos Worker bootstrap.

The product resource path preserves 1/32 MiB content; observed read chunks are
at most 2 MiB. Upload source Blobs are resident, so no bounded upload-memory
claim is made. Process-tree RSS includes shared pages and is not a leak proof.

Upstream paired production calls (ten rounds) reduce C4/C8 P95 from
7.721/15.530 ms to 4.165/7.662 ms; throughput increases from 765/735 to
1,751/1,662 requests/s. Mix/sort full-call paired speedups are 3.98x/8.49x.
Implementation attribution is b314dc13590bacb756579fc509334dd69ef1520b;
8b9b9fc12e273f86091a9d1029d7adb1ecdd43cf adds hardened-runtime qualification.
Both feature and main 13-stage gates, Quick CI and v3.15.0 public completion
passed. Release manifest SHA256 is
335563f292c5302b21a8cb93cf151b2882bc408f28792285d4c88c1deb572d5c.

# Boundaries

These observations qualify only their recorded workloads, releases and sources. Resource RSS includes shared pages/retained allocations; bounded endurance is not leak proof. Different author guests prevent paired throughput/memory comparison. Deferred opening is neither a concurrency cap nor iframe reuse.

Do not infer arbitrary native-library, shell, WASI or sandbox-escape support. Measurements justify no Store pool, persistent native cache, wider SQLite pool or four-surface cap. Production tracing is not a new public contract. The separate complete Desktop I/O workflow remains unqualified pending the release/native work recorded below.

# Evidence

## Qualification outcomes
Component tests cover reveal/visibility/opening/close/disposal, context/retry, unknown outcomes and sibling retirement. Production resource/UI fixtures verify input, native undo, selection, veto, focus, fresh origins and zero final frames. Upstream finite fuel/deadlines, memory, cancel/revoke, Linux static PIE/clone3/seccomp and macOS hardened workloads pass. Product Docker lifecycle, published-source consumption and live author execution pass. An isolated native Desktop starts its local environment/Plugin Center and its bundled signed runtime executes the published author Worker through production Integration; this alone is not full Desktop I/O acceptance.

Both independent 30-minute endurance runs pass. Browser: 100 unique-origin churn cycles, 357 input/visibility/selection checks, native undo/veto/sibling preservation; final frames, page/HTTP errors and guest long tasks all zero. Input+switch P95: candidate 22.83 ms, baseline 23.02 ms. Candidate process-tree RSS: 1,065.02 MiB initial, 502.25 MiB last live, 505.95 MiB after cleanup. Worker: 30m4.40s, 359 batches, 1,436 correct calls, 359 expected application rejections, three gateway renewals and successful Integration close/host-runtime exit. RSS: 71.55/63.78/78.13 MiB initial/final/peak. Baseline: 30 minutes, 1,432 correct calls, 358 expected rejections; author guests differ.

Expanded acceptance found Floe 0.87.2 Monokai hover contrast 4.3187 below the unchanged 4.5 threshold. Upstream 0.87.3 fixes the foreground; consumed Floe 0.90.0 includes it. All 168 upstream theme/variant/engine cases pass; hover is 4.6178. Product 28-theme comparison and connection/management/Workbench checks pass: 154 browser cases requalified on 0.90.0 after concurrent main changes. Single-line actions assert exact 16-pixel layout/scroll heights before/after selection, avoiding transformed rounding.

The Desktop fixture uses published Worker SDK/reviewed connection contracts. Product adapter/localized review require effective admin/read/write/execute authority and exact private prefixes. Isolated Linux uses authenticated public Local UI. Actual Worker I/O verifies 64 MiB filesystem SHA256, 64 one-MiB HTTP requests/direction, oversize rejection and 100 WS/TCP/UDP echoes each without changing released quotas. Native Desktop checks installed inventory while paused, panel dismissal and five reopens; market failure no longer suppresses installed refresh.

Native revocation exposed upstream TCP close-after-cancel returning an erroneous unknown mutation despite closed resources. Deterministic TCP/UDP regressions and focused/performance/stress/property gates pass for the fix. The 3.15.1 exact-main gate/Quick CI passed but immutable Linux source qualification failed: the runaway test could hit its independent deadline before fuel exhaustion. 3.15.2 sets a small test fuel budget and asserts typed failure, changing no production policy. At 0.1 CPU, original fails/ten corrected runs pass; all 186 Linux runtime tests pass. Its 13-stage feature gate passes, including first-attempt performance, 64 revoke acknowledgements at 1 ms P95 versus 500 ms and hardened macOS execution. Public release completion/downstream native requalification remain pending; this is not a complete Desktop I/O pass.

## Provenance
- ReDevPlugin source 8b9b9fc1; Quick CI 41724816794; release 41724964932 attempt 2. Retain initial npm provenance 404; unchanged artifacts pass retry.
- External evidence: redevplugin-implementation, November 3, 2026, task 01a1a274-ecbc-7370-8ebf-e111bf8adee9. Raw trials/harnesses/source identities/failures/acceptance ledger are evidence, not dependencies/configuration.
- Aggregates: product-paired-summary-315.json, product-runtime-cold-summary.json, product-resources-candidate315-summary.json, accepted-paired-summary.json, accepted-throughput-summary.json; endurance: product-ui-soak-summary.json/product-runtime-soak-summary.json with raw samples/pass logs.
- Redeven implementation 902191cb2fe690d84d04824833cf464da82a28e1 passed all three staged-source hook groups. Integration was local; owner excluded push/gate and preserved prior unpublished commits.
