---
type: Development Contract
title: Desktop development sessions and bundles
tags: [desktop, development, storage, retention]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Development launcher owns Desktop, local Runtime, saved Gateways and bundles. Launch exact current source and stop owned services together. Prune only verified inactive bundles, preserving user identity/data, unrelated services and recent/selected/live builds; incomplete inventory blocks pruning.

# Contract

## Build identity and network
scripts/dev_desktop.sh freezes HEAD/tracked/nonignored source; drift fails. Authored OKF/builders/Go embeds are inputs, generated OKF/ignored assets outputs. Reuse requires identical source/deps/tools/target/settings and verified Desktop/immutable Runtime. Missing/corrupt/incomplete output rebuilds; failure never launches old bytes. Only pinned Rust install may change tools. --rebuild forces; REDEVEN_AGENT_FORCE_INSTALL=1 reinstalls three JS packages once. Manifests select pnpm/npm and locks.

Development capture reads the exact Rust pin from `scripts/redevplugin_build_toolchain.json`, the same configuration used by Runtime preparation. Never parse a staging shell assignment for this value. Record the pin and installed compiler identities without auto-installing; absent compilers trigger normal preparation on a cache miss. Invalid pins fail with the configuration path, and a pin change during preparation invalidates the build.

The launcher resolves its physical checkout before assigning profile/service ownership or invoking builders, so checkout aliases share one owner and never skip CLI preparation. Resolve checkout parent aliases before comparing dependency link boundaries. Package-local links remain valid through a managed worktree alias; external links and symlinked dependency roots remain rejected. The target toolchain CLI uses Node's main-module identity so an aliased entrypoint executes preparation instead of silently producing empty output.

macOS samples enabled static HTTP/HTTPS proxies once unless explicit upper/lowercase HTTP_PROXY/HTTPS_PROXY/ALL_PROXY (even empty), or REDEVEN_DEV_SYSTEM_PROXY=0. Preserve NO_PROXY, otherwise add loopback/compatible exclusions. PAC/SOCKS-only requires explicit policy. Never expose credentials/weaken TLS/integrity; remove only inferred env before launch.

Official Node transfers retry three times,1/2s backoff for transport or HTTP408/429/500/502/503/504; permanent HTTP/cert failures stop. Distinguish CONNECT/origin/bytes, retain URL/policy; resume only owned partials and verify full checksum/delete failure. Cache requires fresh official checksum.

Cargo reuse needs freshly staged exact locked public crates and regenerated digest/execution/consumption evidence. Complete cache works offline; missing data requires acquisition. Corruption/compiler errors cannot substitute paths. Isolate releases; source change rebuilds whole product, no component/watch mode.

## Bundle
Include Runtime/plugin runtime/standalone Computer Node/released SDKs/UI, no first-launch download. Chromium is separately confirmed optional [install](../ai/computer-use-browser-installation.md). Bundle main pure-JS/inline CSS; native SDK/updater preserve boundaries, frontend trees build-only. Electron Builder admits main/four preloads/full renderer licenses-workers-fonts-Wasm, excludes tests/maps/demos. ASAR rejects extra entries or>80MiB including unpacked modules; report Runtime/Electron separately.

Computer keeps released layout/licenses/platform binary, excludes maps and verifies exact manifest.upstream.json inventory. macOS verifies before signing; check signature and unsigned Mach-O, normalizing only signature-dependent __LINKEDIT allocation. Derive selected signed record before sealing; reject unsigned-byte/manifest/executable changes. Linux manifest unchanged.

Qualify relocated utilities/helpers offline without source/global Node, Electron cache and archive audit. Report components/largest files; compare equal source/deps, distinguishing installed/compressed bytes.

## Scheduling/lifecycle
Overlap Desktop compile/Runtime preparation; assets-Go/plugins/Computer own outputs. Env typecheck/bundle share checkout lock. Dev skips notice freshness; staged/main enforce, release after assets. Go waits embeds; publish only complete unchanged inputs. Three dependency workers preserve serial digests/order. Failure/cancel retains errors and stops owned descendants.

Reuse compatible intact Gateways; source drift never auto-upgrades. Owner repairs missing/corrupt packages; explicit Update selects build. Cache key includes dirty source; changes retire generation, missing key creates session cache; package owner validates archive.

Read-only startup/cleanup finds schema5 by connection_id, supported old by legacy gateway_id until migration. Never use trust_profile.gateway_id for paths/change records or cleanup-ledger gatewayID. Invalid/current-unknown schema fails without substitution.

Dev gzip1/Brotli4 keeps decoded bytes; release max compression; profile part of identity. Exclude other worktrees/native cache from Gateway copies. Record dependency/verify/Desktop/Runtime/Gateway duration. Rebuilt/reused launch needs saved local Gateway,exact Runtime commit/cleanup; empty-profile timing insufficient. Exit/signals/failure stop owned services only. Electron resolver prints path only, diagnostics stderr, propagates faults/rechecks executable after builds.

## Credentials/retention
Unpackaged dev: AES-256-GCM/random retained0600 profile key protects plaintext, not same-user access. Others use system storage without constructor probes. Legacy Keychain recovery is explicit, never preference/secret read. User action migrates each file atomically; failure retains credentials/Retry/Quit. Corrupt keys cannot reset accounts/Runtime/Keychain.

Publish complete <development-state-root>/desktop/bundles/<manifest-sha256>. Keep newest three plus selected/reused/live: bound verified inactive count, not bytes or active/unverified growth.

# Boundaries

Prune generated packages only in selected profile; builders own in-progress directories.

# Evidence

- `redeven:scripts/dev_desktop.sh` - Source.
- `redeven:scripts/dev_desktop_build_cache.test.mjs` - Tests.
- `redeven:scripts/dev_desktop_gateways.test.mjs` - Tests.
- `redeven:scripts/dev_desktop_build_proxy.test.mjs` and `redeven:scripts/dev_desktop_signal_cleanup_test.sh`
- `redeven:scripts/resolve_node_archive.test.mjs` - Tests.
- `redeven:scripts/run_parallel_builds.test.mjs` - Tests.
- `redeven:scripts/build_assets.test.mjs` - Tests.
- `redeven:scripts/ui_package_install.test.mjs` - Tests.
- `redeven:desktop/src/main/developmentSecretStorage.test.ts` - Tests.
- `redeven:desktop/scripts/build-main.test.mjs` - Tests.
- `redeven:desktop/scripts/package-size.mjs` - Source.
- `redeven:scripts/stage_computer_package.test.mjs` - Tests.
- `redeven:scripts/desktop_signed_manifest.test.mjs` - Tests.
