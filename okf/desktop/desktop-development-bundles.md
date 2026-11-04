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

## Identity, tools and acquisition
`scripts/dev_desktop.sh` freezes HEAD/tracked/nonignored inputs, including authored OKF/builders/Go embeds, and rejects drift. Generated OKF/ignored assets are outputs. Reuse requires identical source/dependencies/tools/target/settings and verified Desktop/immutable Runtime; missing/corrupt/incomplete output rebuilds, never launches old bytes. --rebuild forces; REDEVEN_AGENT_FORCE_INSTALL=1 reinstalls three JS packages once. Manifests choose pnpm/npm/locks; only pinned Rust preparation may install tools.

Read Rust pin from scripts/redevplugin_build_toolchain.json, shared with Runtime preparation, never a shell assignment. Capture pin/installed compiler identities without auto-installing; cache misses prepare absent tools. Invalid pins name configuration; drift invalidates preparation.

Resolve physical checkout before profile/service ownership/building so aliases share one owner and execute CLI preparation. Resolve parent aliases for dependency boundaries: package-local links may survive managed-worktree aliases; external links/symlinked roots remain forbidden. Toolchain CLI uses Node main-module identity.

macOS infers enabled static HTTP/HTTPS proxies once unless explicit HTTP_PROXY/HTTPS_PROXY/ALL_PROXY (either case, even empty) or REDEVEN_DEV_SYSTEM_PROXY=0. Preserve NO_PROXY or add loopback exclusions; PAC/SOCKS-only needs explicit policy. Preserve credentials/TLS/integrity and remove only inferred environment before launch.

Official Node downloads retry three times with1/2s backoff for transport or HTTP408/429/500/502/503/504. Permanent HTTP/certificate failures stop. Retain URL/policy and CONNECT/origin/byte diagnostics. Resume owned partials only; require fresh official checksum for cache, verify complete bytes and delete failures.

Cargo reuse requires exact freshly staged locked public crates and regenerated digest/execution/consumption evidence. Complete cache works offline; missing data requires acquisition. Corruption/compiler failures cannot substitute paths. Isolate releases and rebuild whole product on source change; no component/watch mode.

## Bundle
Include Runtime/plugin runtime/standalone Computer Node/released SDKs/UI without first-launch download. Chromium remains optional [confirmed installation](../ai/computer-use-browser-installation.md). Main is pure JS/inline CSS; native SDK/updater retain boundaries, frontend trees build-only. Electron Builder admits main/four preloads/full renderer licenses/workers/fonts/Wasm; reject tests/maps/demos/extra ASAR entries and>80MiB including unpacked modules. Report Runtime/Electron separately.

Computer retains released layout/licenses/platform binary, excludes maps and checks manifest.upstream.json inventory. macOS verifies pre-signing plus signatures/unsigned Mach-O, normalizing only signature-dependent __LINKEDIT allocation. Derive signed record before sealing; reject unsigned-byte/manifest/executable drift. Linux manifest unchanged. Qualify relocated helpers/utilities offline without source/global Node, audit Electron cache/archive and report components/largest files; compare equal inputs with installed/compressed bytes distinct.

## Scheduling/lifecycle
Overlap Desktop compilation/Runtime preparation; assets-Go/plugins/Computer own outputs. Env typecheck/bundle share checkout lock; Go waits embeds and publication requires complete unchanged inputs. Three dependency workers preserve serial digest/order. Failure/cancel retains errors and stops owned descendants. Dev skips notice freshness; staged/main enforce it and releases run after assets.

Reuse compatible intact Gateways; drift never auto-upgrades. Owner repairs corrupt/missing packages; explicit Update selects a build. Dirty source is in cache key; changes retire generation, missing key creates session cache; archive owner validates. Read-only startup/cleanup locates schema5 by connection_id, supported old schemas by legacy gateway_id until migration; never trust_profile.gateway_id/change records/cleanup-ledger gatewayID for paths. Unknown/invalid schemas fail without substitution.

Dev gzip1/Brotli4 preserves decoded bytes; release uses maximum compression; profile belongs to identity. Exclude other worktrees/native cache from Gateway copies. Record dependency/verification/Desktop/Runtime/Gateway durations. Rebuilt/reused launch acceptance needs saved local Gateway,exact Runtime commit and verified cleanup; empty profile timing is insufficient. Exit/signals/failure stop owned services only. Electron resolver emits only path to stdout, diagnostics stderr, propagates failure and rechecks executable after build.

## Credentials/retention
Unpackaged dev uses AES-256-GCM with random retained0600 profile key, protecting plaintext rather than same-user access. Other modes use system storage without constructor probes. Explicit legacy Keychain recovery never reads preferences/secrets automatically; migrate files atomically, retaining credentials/Retry/Quit on failure. Corrupt keys cannot reset accounts/Runtime/Keychain.

Publish complete <development-state-root>/desktop/bundles/<manifest-sha256>. Keep newest three plus selected/reused/live; bound verified inactive count, not bytes or active/unverified growth.

# Boundaries

Prune generated packages only in selected profile; builders own in-progress directories.

# Evidence

- November 4, 2026: fixed the stale shell-variable Rust-pin reader. An isolated macOS ARM64 session launched the real `dev_desktop.sh` through a managed checkout alias, rebuilt Desktop and published ReDevPlugin 3.15.0 resources, then restarted with verified cache reuse. Both real windows displayed the local Environment as Ready, both Runtime process identities were verified, and the same immutable bundle was reused. The supervised session passed cleanup with no remaining processes. Focused checks passed 39 cases including real Linux amd64/arm64 C/archive/Rust-link probes and offline/download failures; process ownership and all 12 signal/failure cleanup scenarios passed. Preserve the earlier alias-path failures as failed evidence; the final product launch and cache-reuse results are separate successful runs.
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
