---
type: Development Contract
title: Desktop development sessions and bundles
tags: [desktop, development, storage, retention]
lifecycle: contract
reviewed_at: "2026-11-08"
---
# Summary

The launcher owns source-bound Desktop/Runtime/Gateway bundles and a checkout-stable profile. Shared build tooling owns dependency preparation.

# Contract

## Source and tooling
`scripts/dev_desktop.sh` freezes HEAD, tracked and nonignored inputs (including authored OKF/builders/Go embeds), rejects drift and verifies complete immutable outputs. Generated OKF/ignored assets are outputs. Reuse requires matching source/dependencies/tools/target/settings; missing/corrupt output rebuilds, never launches old bytes. `--rebuild` forces; `REDEVEN_AGENT_FORCE_INSTALL=1` reinstalls three JS packages once. Manifests select package manager/locks. `scripts/redevplugin_build_toolchain.json` owns Rust pin; capture installed identities without eager installation, prepare missing tools only on cache miss. Invalid pins name configuration; drift invalidates preparation.

Resolve physical checkout and parent aliases before ownership/build/dependency checks. Managed package-local links may survive aliases; external/sibling source links remain forbidden. Toolchain CLI uses Node main-module identity.

macOS infers static HTTP/HTTPS proxy once unless any explicit proxy variable (including empty/lowercase) or `REDEVEN_DEV_SYSTEM_PROXY=0` exists. Preserve NO_PROXY or add loopback. PAC/SOCKS-only needs explicit policy. Preserve credentials/TLS/integrity; remove only inferred values before launch.

Official Node downloads retry transport/408/429/500/502/503/504 three times with1/2s backoff; permanent HTTP/certificate errors stop. Retain URL/CONNECT/origin/byte diagnostics. Resume owned partials only, freshly verify official checksum for cached/downloaded bytes and delete failures.

Cargo reuse still freshly stages exact locked public crates and regenerates digest/execution/consumption proofs. Complete cache permits offline work; absence acquires, corruption/compiler failure never substitutes. Whole-product rebuild follows source change; no component/watch mode.

## Bundle
Ship Runtime,plugin runtime,standalone Computer Node,released SDK/UI without first-launch download; Chromium remains [explicit installation](../ai/computer-use-browser-installation.md). Main is pure JS/inline CSS; frontend trees build-only, native/updater boundaries unchanged. Electron Builder allows main,four preloads,renderer licenses/workers/fonts/Wasm; reject tests/maps/demos/extra ASAR and >80MiB including unpacked modules. Report Runtime/Electron separately.

Computer preserves released layout/licenses/platform binary, excludes maps, validates manifest.upstream.json. macOS compares pre-signing/signatures/unsigned Mach-O, normalizing only signature-dependent __LINKEDIT; derive signed record before seal and reject manifest/executable drift. Linux manifest unchanged. Qualify relocated helpers offline without source/global Node; audit Electron archive/cache,components/largest files and distinguish installed/compressed bytes under equal inputs.

## Build and lifecycle
Overlap Desktop/Runtime preparation; asset-Go/plugin/Computer workers own outputs. Env typecheck/bundle share checkout lock; Go waits embeds. Three dependency workers retain serial digest/order. Publish only complete unchanged inputs; failure/cancel stops owned descendants and preserves errors. Dev skips notice freshness; staged/main require it,releases run after assets.

Reuse intact compatible Gateways; drift never upgrades automatically. Owner repairs missing/corrupt packages; explicit Update chooses build. Dirty bytes enter cache key; source change retires generation,missing key creates session cache,archive owner validates. Read-only startup/cleanup finds schema5 via connection_id and supported older schemas via legacy gateway_id until migration. Never derive paths from trust_profile.gateway_id/changed records/cleanup-ledger gatewayID; invalid schemas fail unchanged.

Dev gzip1/Brotli4 preserves decoded bytes; release maximizes compression. Compression profile belongs to identity. Exclude other worktrees/native cache from Gateway copies; record dependency/verification/build durations. Rebuild/reuse acceptance needs saved local Gateway,exact Runtime commit and cleanup,not empty-profile timing. Exit/signals/failure stop owned services only. Electron resolver emits path only on stdout,diagnostics stderr; propagate failure/recheck executable after build.

## macOS identity
Launch profile-owned `Redeven Desktop Dev.app` via Launch Services; capture/input authority belongs to separately signed `Redeven Desktop Access Dev.app`. Resolve exact certificate fingerprint before stopping services or capturing cache inputs. Explicit `REDEVEN_DESKTOP_ACCESS_SIGNING_IDENTITY`/`REDEVEN_DESKTOP_MAC_IDENTITY` wins; otherwise choose unique Apple Development, or unique Developer ID Application only if none. Deduplicate fingerprints across keychains; ambiguity/missing keys/invalid explicit values fail,never ad-hoc fallback. Stop-only/dry-run need no keychain.

Certificate plus stable bundle ID preserves designated requirements. Fingerprint enters build-cache identity; native staging revalidates before resource creation. Production uses `REDEVEN_DESKTOP_MAC_IDENTITY` and `com.floegence.redeven.desktop-access`. Computer manifest inventories every helper file/seal; outer Electron signing preserves it. Reject missing/ambiguous app inventory. Relay carries only explicit exclusion PID/media metadata.

## Profiles, storage and credentials
Profile follows physical checkout across branches; source selects bundle,not new data. Older code may reject newer state: use compatible Runtime or explicit isolated `REDEVEN_STATE_ROOT`,never reset/bypass formats.

Before stop/build, inspect retired plugin placement without opening platform DBs. Explicit `--relocate-storage` previews,uses selected profile stop inventory,applies existing offline journal and verifies readiness. Invalid/no-stop combinations fail before shutdown; no clearing/bypassing links. [Storage ownership](../architecture/storage-ownership.md) owns relocation. Native qualification requires published-source runtime,retained state and real sandbox/Worker; admission-only fixtures prove no usability.

Unpackaged dev encrypts with AES-256-GCM/random retained0600 profile key (not same-user protection); other modes use system storage without constructor probes. Legacy Keychain recovery is explicit,never automatically reads preferences/secrets. Atomic migration retains credentials/Retry/Quit on failure; corrupt key never resets accounts/Runtime/Keychain.

Publish complete `<development-state-root>/desktop/bundles/<manifest-sha256>`. Keep newest three plus selected/reused/live; bound verified inactive count,not bytes or active/unverified growth.

# Boundaries

Prune only selected-profile generated packages; builders own in-progress directories. Preserve grants and unrelated processes.

# Evidence

- November8 macOS ARM64 isolated rebuild/reuse with unset signing variables selects installed development certificate,strictly verifies helper,starts saved Gateway/exact Runtime/Environment and cleans processes/ports/profile. Initial external-volume attempt waits removable-volume consent; internal-disk task checkout succeeds without TCC change. Certificate/native seal/cache and18 lifecycle scenarios pass.
- November4 alias rebuild/reuse verifies saved Gateway,ready Environment,exact identities/cleanup;39 focused and12 signal/failure cases. Prior alias failures retained.
- November8 Launch Services fixture verifies independent TCC identity,no unrequested grant,sandboxed renderer,normal/error/interrupt cleanup; UI covers permission destinations/refresh. Signed-helper/localized usage/enclosing seal/relocation pass; ad-hoc/missing identity fails before staging. No grants requested or TCC reset.

Sources: `scripts/dev_desktop.sh`, `scripts/dev_desktop_build_cache.test.mjs`; Git retains original run details.
