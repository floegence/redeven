---
type: Development Contract
title: Desktop development sessions and bundles
tags: [desktop, development, storage, retention]
lifecycle: contract
reviewed_at: "2026-11-08"
---
# Summary

Launcher owns source-bound Desktop/Runtime/Gateway bundles and checkout-stable profile; shared build tooling owns dependency preparation. Reuse requires matching source, dependencies, tools, target and settings together with intact outputs. Stale or drifted inputs require rebuilding before launch.

# Contract

## Source and tooling
scripts/dev_desktop.sh freezes HEAD/tracked/nonignored inputs, including authored OKF/builders/embeds, rejects drift and verifies immutable outputs. Generated OKF/ignored assets are outputs. Reuse needs matching source/dependencies/tools/target/settings and intact output; otherwise rebuild, never old bytes. --rebuild forces; REDEVEN_AGENT_FORCE_INSTALL=1 reinstalls three JS packages once. Manifests select managers/locks; redevplugin_build_toolchain.json pins Rust. Capture tool identity without eager install; prepare missing tools only on cache miss. Invalid pins name configuration; drift invalidates preparation.

Resolve physical checkout/parent aliases before ownership/build checks. Managed package-local links may survive aliases, never sibling/external source links. Toolchain CLI uses Node main-module identity. macOS infers static HTTP/HTTPS proxy once only absent any explicit variable (including empty/lowercase) and REDEVEN_DEV_SYSTEM_PROXY=0; preserve NO_PROXY or add loopback. PAC/SOCKS needs explicit policy. Preserve TLS/credentials/integrity; strip inferred proxy only before launch.

Official Node acquisition retries transport/408/429/500/502/503/504 three times with1/2s backoff; permanent HTTP/certificate errors stop. Retain CONNECT/origin/URL/byte diagnostics. Resume owned partials only, freshly check official checksum for cache/download and remove failed bytes. Cargo reuse still stages exact public locked crates and regenerates digest/execution/consumption proof; complete cache allows offline, corruption/compiler error never substitutes. Source changes rebuild whole product, no watch/component shortcut.

## Bundle
Ship Runtime/plugin runtime/standalone Computer Node/released SDK/UI without first-launch downloads; Chromium [install](../ai/computer-use-browser-installation.md) stays explicit. Main pureJS/inlineCSS; frontends build-only, native/updater unchanged. Builder allows main/four preloads/licenses/workers/fonts/Wasm; reject tests/maps/demos/extraASAR and>80MiB including unpacked modules. Report Runtime/Electron separately.

Computer retains released layout/licenses/platform binary, no maps, validates manifest.upstream.json. macOS validates pre-signing/signatures/unsigned Mach-O, normalizing only signature-dependent __LINKEDIT; derive signed record before seal and reject executable/manifest drift. Linux manifest unchanged. Qualify relocated offline helpers without source/globalNode; audit archive/cache/components and distinguish compressed/installed size under equal inputs.

## Build and lifecycle
Desktop/Runtime preparation overlaps; asset-Go/plugin/Computer workers own outputs. Env typecheck/build share checkout lock; Go waits for embeds. Three dependency workers retain serial digest/order. Publish only complete unchanged inputs; cancel/failure stops owned descendants and preserves errors. Dev skips notice freshness, staged/main require it, release runs after assets.

Reuse compatible intact Gateways; drift never auto-upgrades. Repair missing/corrupt owned packages; explicit Update selects build. Dirty bytes enter key; source changes retire generation, missing key creates session cache and owner validates archive. Read-only startup/cleanup uses schema5 connection_id and supported older gateway_id until migration, never trust_profile/changed-record/ledger gatewayID paths. Invalid schema stays unchanged.

Dev gzip1/Brotli4 preserves bytes; release maximizes, profile part of identity. Gateway copies exclude other worktrees/native caches. Record dependency/verification/build timings. Rebuild/reuse acceptance requires saved Gateway, exact Runtime and cleanup, not empty-profile speed. Exit/signals/failure stops only owned services. Electron resolver stdout is path, stderr diagnostics; propagate failure/recheck executable after build.

## macOS identity
Launch profile-owned Redeven Desktop Dev.app through Launch Services; separate signed Redeven Desktop Access Dev.app owns capture/input. Resolve exact fingerprint before stopping/capturing inputs. Explicit access/mac signing identity wins, otherwise unique Apple Development or unique Developer ID Application only if none. Deduplicate keychains; missing/ambiguous/invalid keys fail, no ad-hoc fallback. Stop-only/dry-run needs no keychain.

Certificate+bundleID keeps designated requirement; fingerprint enters cache identity and staging revalidates before resources. Production uses REDEVEN_DESKTOP_MAC_IDENTITY/com.floegence.redeven.desktop-access. Computer manifest inventories helpers/seal, outer Electron signing preserves it. Reject ambiguous/missing app inventory; relay carries only explicit exclusionPID/media metadata.

## Profiles, storage and credentials
Physical checkout owns profile across branches; source changes bundle, not data. Older builds may reject newer state: use compatible Runtime or explicit isolated REDEVEN_STATE_ROOT, never reset/bypass. Before stop/build inspect retired plugin placement without opening platform DBs. Explicit --relocate-storage previews, stops selected profile, applies existing offline journal and verifies; invalid/no-stop fails before shutdown. [Storage](../architecture/storage-ownership.md) owns confined links/relocation. Native acceptance needs public-source runtime, retained state and real sandbox/Worker, not admission fixture.

Unpackaged dev encrypts AES256GCM with retained random0600profile key (no same-user protection); other modes use system storage without constructor probes. Legacy Keychain recovery is explicit, no automatic secrets/preferences read. Atomic migration preserves credentials/Retry/Quit; corruption never resets accounts/Runtime/Keychain.

Publish complete desktop/bundles/<manifest-sha256>. Keep newest3 plus selected/reused/live; bound verified inactive count, not bytes/unverified/active growth.

# Boundaries

Prune only selected-profile generated packages; builders own in-progress directories. Preserve grants/unrelated processes.

# Evidence

November8 ARM64 rebuild/reuse selected installed certificate with unset overrides, verified helper, saved Gateway/exact Runtime/Environment and cleanup. External-volume consent wait retained; internal task checkout passed without TCC change. Seal/cache and18lifecycle cases passed. November4 physical-alias rebuild/reuse passed39focused/12signal-failure cases, retaining original failures. Launch Services fixture verified independent TCC identity/no grant, sandbox, normal/error/interrupt cleanup and permission destinations/refresh. Signed helper/localized usage/enclosing seal/relocation passed; invalid identity failed before staging, no TCC reset. Sources: dev_desktop.sh/dev_desktop_build_cache.test.mjs; Git retains run detail.
