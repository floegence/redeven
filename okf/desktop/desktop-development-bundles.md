---
type: Development Contract
title: Desktop development sessions and bundles
tags: [desktop, development, storage, retention]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

- Authority: launcher owns Desktop, local Runtime, saved Gateways and bundles.
- Outcome: run current source, stop together, prune old bundles.
- Invariants: preserve data, identities, unrelated services and recent/selected/live bundles.
- Failure: preparation cleans up; incomplete inventory prevents pruning.

# Contract

## Source and build identity
scripts/dev_desktop.sh captures HEAD and tracked/nonignored source; mutation fails. Generated OKF/ignored assets are outputs; authored OKF/builders/Go embeds are inputs. Reuse requires identical source, dependencies, tools, target/settings and verified Desktop/immutable Runtime bytes. Missing/corrupt/incomplete output rebuilds; failure never launches old bundles. Only pinned Rust installation may change tools. --rebuild forces build; REDEVEN_AGENT_FORCE_INSTALL=1 reinstalls all three JS packages once. Manifests select pnpm/npm and their locks, not compatibility-lock installers.

## Network and caches
macOS preparation reads enabled static HTTP/HTTPS system proxies once. Any explicit HTTP_PROXY/HTTPS_PROXY/ALL_PROXY (including lowercase/empty) or REDEVEN_DEV_SYSTEM_PROXY=0 disables discovery. Preserve explicit NO_PROXY, otherwise add loopback/compatible exclusions. PAC/SOCKS-only needs explicit policy. Never log credentials or weaken TLS/artifact checks. Remove only inferred variables before launching services.

Official Node checksum/archive transfers each get three attempts, 1/2-second backoff for transport or HTTP 408/429/500/502/503/504; permanent HTTP/certificate errors stop. Separate CONNECT/origin status from bytes. Retry the same official URL/policy; resume only this build's partial archive, verify complete checksum, delete failed partials. Cached archives still need fresh official checksums.

Development may reuse Cargo registry/target caches but freshly stage exact locked public crates and regenerate verified digest/execution/consumption evidence. Complete caches work offline; incomplete caches acquire explicitly. Corruption/compiler errors cannot switch paths. Release directories remain isolated. Source changes rebuild the whole product, without component/watch mode.

## Scheduling and lifecycle
Desktop compile overlaps Runtime preparation. Runtime assets/Go, plugins and Computer resources own separate outputs. Env App typecheck overlaps bundling under checkout lock. Development builds skip notice freshness; staged/main gates own admission. Sequential release builds check notices after asset tasks. Go waits for embeds; publication waits for complete outputs and unchanged inputs. Three dependency workers overlap probes with serial-equivalent digests/order. Supervisors preserve errors and stop owned descendants on cancellation/failure.

Saved local Gateways reuse intact compatible installs; source changes do not force upgrade. Service owner repairs missing/damaged packages; explicit Update selects current build. Archive cache keys include dirty source; changed inputs discard old cache generation, absent keys create a session cache. Package owner validates archives.

Dev gzip1/Brotli 4 retains identical decoded bytes; normal/release compression stays maximum. Profile is part of identity. Gateway source copies exclude other worktrees/native caches. Log dependency/verification/Desktop/Runtime/Gateway durations. Qualify rebuilt and reused launches with a saved local Gateway, exact Runtime commit and cleanup; empty-profile warm measurements alone are insufficient.

Exit/preparation failure/signals stop only owned services. Electron resolution outputs only its path, logs to stderr, propagates errors and rechecks executable after dependency builds.

## Credentials and retention
Unpackaged development uses AES-256-GCM with a random retained 0600 profile key: plaintext protection, not protection from the same user. Other launches use Electron system storage without constructor probes. Legacy Keychain offers explicit recovery; never read preferences/system secrets implicitly. Each file migrates atomically only after user action. Failure retains credentials/retry/quit; corrupt keys never reset accounts/Runtime/Keychain.

Publish complete bundles under <development-state-root>/desktop/bundles/<manifest-sha256>. Retain newest three, selected/reused and all live bundles. This bounds inactive verified count, not total bytes; active/unverified entries may grow.

# Boundaries

Retention only touches generated packages in the selected profile. Builders own
in-progress directories.

# Evidence

- `redeven:scripts/dev_desktop.sh` - Publication, launch and cleanup.
- `redeven:scripts/dev_desktop_build_cache.test.mjs` - Input drift, corruption and toolchain admission.
- `redeven:scripts/dev_desktop_build_proxy.test.mjs` and `redeven:scripts/dev_desktop_signal_cleanup_test.sh` - Proxy precedence, preparation inheritance and launch isolation.
- `redeven:scripts/resolve_node_archive.test.mjs` - Bounded HTTPS retry, permanent failure, checksum and partial-file cleanup.
- `redeven:scripts/run_parallel_builds.test.mjs` - Overlap, failure and descendant cleanup.
- `redeven:scripts/build_assets.test.mjs` - Development/release notice boundaries and build failures.
- `redeven:scripts/ui_package_install.test.mjs` - Manager selection, repeat installs and failure.
- `redeven:desktop/src/main/developmentSecretStorage.test.ts` - Restart, migration, failures, tags and permissions.
