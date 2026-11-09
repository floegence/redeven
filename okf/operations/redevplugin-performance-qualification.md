---
type: Validation Report
title: ReDevPlugin 3.15 performance qualification
tags: [plugins, performance, runtime, validation]
lifecycle: active_evidence
reviewed_at: "2026-11-04"
---
# Summary

Published ReDevPlugin 3.15.0 improved measured warm execution. Redeven defers unopened hidden placements while retaining independent opened surfaces. [Host boundary](../architecture/redevplugin-boundary.md) owns current platform contracts.

# Contract

Use coordinated published Go/npm/Rust without overrides. Rust 1.98.0 builds Wasmtime 50. Product staging/consumption verifies the macOS hardened runtime's exact upstream executable-memory exception; package provenance is not product signing.

First open captures current context/revision; closing unopened placement prevents later open. Hiding does not cancel admitted invocation, replay uncertain writes or reuse revoked authority. Worker application errors do not destroy surfaces. See [recovery](../architecture/redevplugin-surface-recovery.md).

# Measurement

November 3, 2026, macOS ARM64, Node 26.7.0, Go 1.27.3, Rust 1.98.0. Baseline 2433435341c55aa34013de78c1ab023277d96639; both variants use published ReDevPlugin 3.15.0/Floe 0.87.2 and durable production Integration HTTP. Only the prior UI component differs. Fifteen alternating fresh-browser pairs/scenario, 60 trials; 10,000 deterministic bootstrap resamples.

| Scenario | Baseline → candidate | Scope |
| --- | --- | --- |
| One visible placement ready |132.4→57.5 ms|Paired 2.315x, 95% interval 2.167–2.371|
| Incremental process-tree RSS |867.59→105.86 MiB|Ten frames→one; shared pages included|
| Deferred first activation |0.1→49.1 ms|Candidate P95 53.99 ms|
| Ten visible ready |134.3→133.8 ms|Ten independent frames|
| Fresh Worker/state total |335.68→504.05 ms|+168.37 ms, below declared 1s budget|
| First Worker call |6.05→4.39 ms|Excludes setup|
| 64 KV writes, individual→batch |225.5→4.55 ms|Paired 50.34x; values/rollback|
| Six statements, individual→transaction |48.15→8.15 ms|Paired 5.63x; trigger retained|

Cold pairs retain identical 3.14 echo guest bytes/fresh process/state/warm OS cache. Install/grant/prewarm 78.49→186.86 ms. Current 3.15 author guest separately passes hardened smoke. Resource reads preserve 1/32 MiB with <=2 MiB chunks; resident upload Blobs prevent bounded-memory claims. Neither editor/network SLA nor complete Memos bootstrap is measured.

Upstream ten-round production C4/C8 P95 7.721/15.530→4.165/7.662 ms; throughput 765/735→1,751/1,662 requests/s. Mix/sort paired speedups 3.98x/8.49x. Implementation b314dc13590bacb756579fc509334dd69ef1520b; hardened qualification 8b9b9fc12e273f86091a9d1029d7adb1ecdd43cf. Both 13-stage gates, Quick CI and public completion passed; manifest SHA256 335563f292c5302b21a8cb93cf151b2882bc408f28792285d4c88c1deb572d5c.

# Boundaries

Results certify recorded workloads/source only. Deferred opening is neither concurrency cap nor iframe reuse. RSS/endurance prove no leak freedom; differing author guests prevent paired memory/throughput claims. No arbitrary native library/shell/WASI/escape support, Store pool/cache/SQLite widening or four-surface cap follows. Complete Desktop I/O remains unqualified at this record.

# Evidence

- Component/resource/browser fixtures cover retained input, native undo, selection, close veto, fresh origins, focus, unknown outcomes and zero final frames. Upstream fuel/deadlines/memory/cancel/revoke/Linux static PIE/clone3/seccomp/macOS hardened workloads pass. Product Docker, published-source consumption and real author Worker pass. Native Desktop starts Environment/Center and executes bundled signed Worker through Integration; this is not full Desktop I/O.
- Two independent 30-minute endurance runs pass. Browser: 100 origin churns/357 interaction checks; zero final frames/errors/guest long tasks. Input+switch P95 22.83 versus 23.02 ms. Candidate RSS initial/live/cleanup 1065.02/502.25/505.95 MiB. Worker: 30m4.40s,359 batches/1436 correct/359 expected rejects,three gateway renewals,clean close; RSS initial/final/peak71.55/63.78/78.13 MiB. Baseline1432 correct/358 rejects uses different author guest.
- Expanded contrast initially failed unchanged 4.5 threshold: Floe0.87.2 Monokai4.3187. Upstream0.87.3 fixes foreground; consumed0.90.0 hover4.6178,168 theme/variant/engine and154 product browser cases pass. Actions retain exact16px line/scroll height before/after selection.
- Published Worker/private connection contract requires current admin/read/write/execute and exact prefixes. Authenticated Linux fixture verifies64MiB filesystem SHA256,64×1MiB HTTP each direction,oversize rejection and100 WS/TCP/UDP echoes each. Native Desktop verifies paused inventory,dismissal/five reopens; market failure cannot suppress installed refresh.
- Native revocation found erroneous TCP unknown-mutation after resources closed. TCP/UDP/focused/performance/stress/property fixes pass. v3.15.1 exact-main gate/CI pass but immutable Linux fuel test loses to independent deadline. v3.15.2 lowers test-only fuel: original fails at0.1CPU,ten corrected runs and186 Linux tests pass. All13 feature stages pass;64 revoke acknowledgements P95 1ms versus500ms. Public completion/downstream native requalification remained pending; no full Desktop I/O pass.

Provenance: source8b9b9fc1; CI41724816794; release41724964932 attempt2 (initial npm404 retained). External task `redevplugin-implementation`, 2026-11-03, `01a1a274-ecbc-7370-8ebf-e111bf8adee9` retains raw trials/failures/source identities and product-{paired,runtime-cold,resources-candidate315}-summary, accepted-{paired,throughput}-summary, product-{ui,runtime}-soak-summary JSON. Redeven902191cb2fe690d84d04824833cf464da82a28e1 passed staged checks; integration local, push/gate excluded, unpublished history preserved.
