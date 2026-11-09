---
type: Validation Report
title: ReDevPlugin 3.15 performance qualification
tags: [plugins, performance, runtime, validation]
lifecycle: active_evidence
reviewed_at: "2026-11-04"
---
# Summary

ReDevPlugin3.15.0 improved measured warm execution. Redeven defers unopened placements while retaining opened surfaces. [Host boundary](../architecture/redevplugin-boundary.md) owns current contracts; these source/workload-specific results are not a universal SLA.

# Contract

Consume coordinated public Go/npm/Rust without overrides; Rust1.98.0 builds Wasmtime50. Product staging must verify macOS hardened runtime's exact upstream executable-memory exception; provenance is not signing. First open captures current context/revision; closing unopened placement prevents delayed open. Hiding never cancels admitted work, replays uncertainty or reuses revoked authority. Worker app errors retain surfaces. [Recovery](../architecture/redevplugin-surface-recovery.md) owns lifecycle.

# Measurement

November3/macOSARM64/Node26.7.0/Go1.27.3/Rust1.98.0; baseline2433435341c55aa34013de78c1ab023277d96639. Both variants used published3.15.0/Floe0.87.2 and durable Integration HTTP, differing only in prior UI. Fifteen alternating fresh-browser pairs/scenario,60trials,10000bootstrap resamples:
- One placement ready132.4→57.5ms, paired2.315x/95%2.167–2.371; incremental whole-tree RSS867.59→105.86MiB (ten→one frames, shared pages counted).
- Deferred activation0.1→49.1ms, candidateP95 53.99; ten visible134.3→133.8ms, independent frames.
- Fresh Worker/state335.68→504.05ms (+168.37, declared1s budget); first call6.05→4.39ms excludes setup. Install/grant/prewarm78.49→186.86ms.
- 64KV individual→batch225.5→4.55ms (50.34x); six statements→transaction48.15→8.15ms (5.63x), values/rollback/trigger retained.

Cold comparisons used identical3.14 echo bytes, fresh state/process and warm OS cache. Current author guest separately passed hardened smoke. Exact1/32MiB resource reads use <=2MiB chunks; resident upload Blobs preclude bounded-memory claims. No editor/network SLA or complete Memos bootstrap measurement.

Upstream ten-round C4/C8 P95 7.721/15.530→4.165/7.662ms; throughput765/735→1751/1662requests/s; mix/sort3.98x/8.49x. Implementation b314dc13590bacb756579fc509334dd69ef1520b, qualification8b9b9fc12e273f86091a9d1029d7adb1ecdd43cf passed13-stage/Quick/public completion. Immutable release evidence retains manifest hashes.

# Boundaries

Deferral is not concurrency cap/frame reuse. RSS/endurance proves no leak freedom; different guests invalidate paired memory/throughput claims. No new native-library/shell/WASI/escape/Store pool/cache/SQLite authority or four-surface cap follows. Complete Desktop I/O remains unqualified.

# Evidence

Component/browser tests retain input/undo/selection/veto/origins/focus/unknowns and zero final frames. Upstream covers fuel/deadline/memory/cancel/revoke, Linux staticPIE/clone3/seccomp and hardened macOS. Product Docker/published consumption/author Worker passed; native Desktop starts Environment/Center and runs signed Worker, not complete I/O.

Independent30-minute endurance: browser100origin churns/357checks, zero final frames/errors/guest long tasks; input+switchP95 22.83vs23.02ms, candidateRSS initial/live/cleanup1065.02/502.25/505.95MiB. Worker30m4.40s/359batches/1436correct/359expected rejects/three renewals/clean close, RSS71.55/63.78/78.13MiB initial/final/peak; baseline guest differs.

Initial contrast failed4.5 (Floe0.87.2 Monokai4.3187); upstream0.87.3 repair consumed through0.90.0 yields4.6178hover,168theme/engine and154browser passes with16px line/scroll preserved. Authenticated private connections require current admin/RWX/exact prefixes; Linux verifies64MiB SHA256,64×1MiB HTTP each way, oversize rejection and100WS/TCP/UDP echoes. Desktop inventory pause/dismiss/five reopens passed; market failure retains installed refresh.

Native revoke initially reported TCP unknown-mutation after closure. Focused/race/stress/property fixes passed;3.15.1 gate/CI passed but Linux fuel test lost to independent deadline. Test-only fuel correction in3.15.2 retained original0.1CPU failure, ten corrected runs/186Linux tests/13stages;64revoke acknowledgementsP95 1ms vs500ms. Public/downstream native requalification remained pending: no full-I/O pass.

CI41724816794/release41724964932 attempt2 retain initial npm404. External redevplugin-implementation task01a1a274-ecbc-7370-8ebf-e111bf8adee9 retains raw paired/cold/resource/throughput/soak reports. Redeven902191cb2fe690d84d04824833cf464da82a28e1 staged checks passed; local integration excluded push/gate and preserved unpublished history.
