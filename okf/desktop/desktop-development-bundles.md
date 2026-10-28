---
type: Development Contract
title: Desktop development sessions and bundles
description: Own development services, credentials and bundle retention.
tags: [desktop, development, storage, retention]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-28"
---
# Summary

- Authority: the launcher owns Desktop, local Runtime, saved local Gateways, and bundles.
- Outcome: run current source, stop together, prune obsolete bundles.
- Invariants: preserve user data, identities, unrelated services, and recent, selected or live bundles.
- Failure boundary: preparation errors clean up; incomplete inventory prevents pruning.

# Contract

## Build and launch

scripts/dev_desktop.sh captures HEAD/current tracked and non-ignored source; concurrent edits fail. Generated OKF/ignored assets are outputs; protect authored OKF/builders/Go embeds. A profile-local receipt reuses output only when HEAD, dirty source, dependency bytes, toolchains, target/settings and verified Desktop/immutable Runtime bytes match. Missing/changed/incomplete output rebuilds; failed preparation never launches old bundles. Only installing pinned Rust admits preparation-time toolchain drift.

--rebuild forces build; REDEVEN_AGENT_FORCE_INSTALL=1 reinstalls all three JS packages once. Manifests choose pnpm/npm; receipts bind selected locks/toolchain, not a second installer from compatibility locks. First launch establishes receipts.

On macOS, preparation reads enabled static HTTP/HTTPS system proxies once and exports them to dependency and bundle build tools. Any explicit HTTP_PROXY/HTTPS_PROXY/ALL_PROXY variable (including lowercase or empty values) owns network policy and disables discovery; REDEVEN_DEV_SYSTEM_PROXY=0 also opts out. Preserve explicit NO_PROXY; otherwise include loopback and compatible system exclusions. PAC/SOCKS-only settings require explicit environment policy. Diagnostics never expose credentials; TLS and official artifact verification remain mandatory. Remove only inferred variables before launching Desktop, Runtime or Gateways.

Official Node checksum and archive acquisition share a three-attempt budget per transfer, with one- and two-second backoff for transient transport failures and HTTP 408/429/500/502/503/504. Read origin and proxy CONNECT status separately from artifact bytes; permanent HTTP and certificate errors stop immediately. Retry the same official URL under the existing proxy policy. Resume only the current build's temporary archive; verify the complete checksum before caching, remove failed partial files, and require fresh official checksums even for cached archives.

Development may cache Cargo registry/targets while staging exact locked published crates freshly. Verify digest/execution/consumption and regenerate evidence. Complete caches resolve/install offline; incomplete caches follow acquisition policy with diagnostics. Corrupt crates or compiler failure cannot retry via another path. Release Cargo dirs stay isolated. Source changes rebuild whole product, not component/watch mode.

Desktop compilation overlaps Runtime preparation. Runtime assets/Go, plugin staging and Computer resources have independent outputs. Env App no-emit typecheck overlaps bundling under its checkout lock. Notices run after all asset tasks because installed metadata/YAML parser cannot race cold dependency install. Go waits for embeds; publication/receipts wait for all builds and unchanged-input checks. Release order stays sequential.

Three dependency-scan workers overlap toolchain probes with serial-equivalent digests/order. Supervisors label diagnostics, preserve failures and stop owned groups/descendants on cancel or sibling failure.

Saved local Gateways reuse compatible intact installs; Desktop source change does not force replacement. Service owner prepares missing/damaged packages; explicit Update selects current build. Verified archive caches bind full launch input key including dirty source; changed keys discard previous generation, missing key creates session cache. Package owner verifies archives.

Dev embedded compression: gzip1/Brotli4 with identical decoded bytes; ordinary/release use maximum. Profile enters build identity. Gateway source copies omit unrelated worktrees/native caches. Logs separate dependencies/verification/Desktop/Runtime/Gateway phases and total. Empty-profile warm timings cannot certify changed-source/saved-Gateway launches; qualify both rebuilt/reused launches with local Gateway, exact Runtime commit and cleanup.

Normal exit, preparation failure, Ctrl+C/SIGTERM stop only owned local services; production shutdown semantics remain. Electron resolution emits path only, logs to stderr, propagates failure and rechecks executable after dependency builds.

## Credentials and retention

Unpackaged dev encrypts with AES-256-GCM/random profile key 0600, retained with profile; protects plaintext, not same-user access. Other launches use Electron system storage without constructor probing. Legacy Keychain opens recovery without reading preferences/system secrets; only explicit action decrypts and atomically migrates each file. Failure preserves credentials/retry/quit; corrupt keys require repair, never reset accounts/Runtime/Keychain.

Publish complete bundles under <development-state-root>/desktop/bundles/<manifest-sha256>. Keep newest three, selected (including reuse) and all live bundles. This bounds inactive verified package count, not bytes; active/unverified entries may grow.

# Boundaries

Retention only touches generated packages in the selected profile. Builders own
in-progress directories.

# Evidence

- `redeven:scripts/dev_desktop.sh` - Publication, launch and cleanup.
- `redeven:scripts/dev_desktop_build_cache.test.mjs` - Input drift, corruption and toolchain admission.
- `redeven:scripts/dev_desktop_build_proxy.test.mjs` and `redeven:scripts/dev_desktop_signal_cleanup_test.sh` - Proxy precedence, preparation inheritance and launch isolation.
- `redeven:scripts/resolve_node_archive.test.mjs` - Bounded HTTP/transport retries, real HTTPS 503 recovery, permanent failures, checksum admission and partial cleanup.
- `redeven:scripts/run_parallel_builds.test.mjs` - Overlap, failure and descendant cleanup.
- `redeven:scripts/build_assets.test.mjs` - Cold-install ordering and asset/notice failure propagation.
- `redeven:scripts/ui_package_install.test.mjs` - Manager selection, repeat installs and failure.
- `redeven:desktop/src/main/developmentSecretStorage.test.ts` - Restart, migration, failures, tags and permissions.
