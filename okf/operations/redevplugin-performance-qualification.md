---
type: Validation Report
title: ReDevPlugin 3.15 performance qualification
tags: [plugins, performance, runtime, validation]
lifecycle: active_evidence
reviewed_at: "2026-11-03"
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

Plugin component tests cover first reveal, document visibility, hide while
opening, unopened close/disposal, context/retry, unknown outcomes and sibling
retirement. Production resource and UI fixtures verify inputs, native undo,
selection, close veto, focus, fresh origins and zero final frames. Runtime
qualification uses finite fuel/deadlines, memory bounds, cancellation and
revocation. Linux sealed static PIE/clone3/seccomp and macOS hardened workloads
pass upstream. Product Docker lifecycle, published source consumption and live
author execution pass. An isolated native Desktop build also starts its local
environment and Plugin Center. Its exact bundled hardened runtime executes the
current published author Worker successfully through production Integration;
this does not certify the separate full Desktop I/O workflow.

Both independent product endurance runs complete. The candidate browser passes
100 unique-origin churn cycles and 30 minutes with 357 input/visibility/selection
checks, native undo, close veto and sibling-preserving retirement; final live
frames, page/HTTP errors and observed guest long tasks are all zero. Input plus
switch P95 is 22.83 ms (baseline 23.02 ms). Candidate process-tree RSS during the
soak is 1,065.02 MiB initially and 502.25 MiB at the last live sample; it is
505.95 MiB after frame cleanup. RSS includes shared pages and retained browser
allocations, so this is bounded-duration evidence rather than proof of no leak.

Candidate Worker endurance completes 30m4.40s: 359 batches, 1,436 correct calls,
359 expected application rejections, three normal gateway renewals and successful
Integration close. The host and runtime exit. Observed host/runtime process-tree
RSS is 71.55 MiB initially, 63.78 MiB finally and 78.13 MiB at peak. The baseline
also completes 30 minutes (1,432 correct calls, 358 expected rejections). Author
guests differ in these endurance runs; they are correctness/lifetime checks,
not a paired throughput or memory-performance comparison.

The original expanded acceptance exposed Monokai hover contrast of 4.3187
against the unchanged 4.5 threshold in Floe 0.87.2. The owning Floe repository
fixed the foreground color and published 0.87.3; Redeven consumes 0.89.1, which
includes the fix. The upstream matrix passes all 168 cases across 28 themes,
two variants and three engines. Monokai hover is now 4.6178. The product's
28-theme comparison and connection/management/Workbench checks also pass: all
154 browser cases are requalified on 0.89.1 after retaining concurrent main
changes. Single-line action geometry uses exact 16-pixel layout and scroll
heights before and after selection, avoiding transformed viewport rounding.

The legacy Desktop fixture now uses the published Worker SDK and explicit
reviewed connection contracts. The product adapter and localized review UI
require effective administrator/read/write/execute authority and exact private
prefixes. The isolated Linux target uses authenticated public Local UI routing.
Actual Worker I/O validates 64 MiB filesystem SHA256, 64 one-MiB HTTP requests
per direction, oversized transfer rejection and 100 WS/TCP/UDP echoes each.
The released single-request quotas remain unchanged. Native Desktop verifies
installed inventory while the server is paused, panel dismissal and five reopen
cycles. Market refresh failures no longer suppress installed inventory refresh.

Native revocation acceptance then exposed a platform defect: cancellation
closed the underlying TCP socket before explicit revocation, so the second close
returned an erroneous unknown mutation outcome despite closed resources. This
has deterministic TCP/UDP regressions and a fix whose focused tests, full
performance, stress and property gates pass. Coordinated 3.15.1 publication and
downstream native requalification remain pending after transient registry
failures. It is not yet a complete Desktop I/O pass. Failure evidence is retained.

No Store pool, persistent native cache, wider SQLite pool or four-surface cap is
introduced: measurements do not justify their complexity. Production phase
tracing is not shipped as a new public contract. This qualification does not
claim arbitrary native-library, shell, WASI or browser-sandbox escape support.

# Evidence

- ReDevPlugin source 8b9b9fc1; Actions Quick CI 41724816794 and release
  41724964932 attempt 2. The first attempt's temporary npm provenance 404 is
  retained; unchanged release artifacts passed the retry.
- External task evidence directory: redevplugin-implementation, November 3
  2026, task 01a1a274-ecbc-7370-8ebf-e111bf8adee9. It retains raw trials,
  harnesses, source identities, failures and the acceptance ledger; it is not a
  dependency or production configuration.
- product-paired-summary-315.json, product-runtime-cold-summary.json,
  product-resources-candidate315-summary.json, accepted-paired-summary.json and
  accepted-throughput-summary.json record the measured aggregates.
- product-ui-soak-summary.json and product-runtime-soak-summary.json bind the
  completed endurance results to their retained raw samples and pass logs.
- Redeven implementation commit is 902191cb2fe690d84d04824833cf464da82a28e1;
  its normal staged-source commit hook passed all three groups.
- Redeven integration is local only for this task. Its push gate and push are
  explicitly excluded by the owner; prior unpublished main commits are kept.
