---
type: Development Contract
title: Desktop development sessions and bundles
description: Own development services, credentials and bundle retention.
tags: [desktop, development, storage, retention]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-26"
---
# Summary

- Authority: the launcher owns Desktop, local Runtime, saved local Gateways, and bundles.
- Outcome: run current source, stop together, prune obsolete bundles.
- Invariants: preserve user data, identities, unrelated services, and recent, selected or live bundles.
- Failure boundary: preparation errors clean up; incomplete inventory prevents pruning.

# Contract

## Service lifecycle
`scripts/dev_desktop.sh` builds current tracked/non-ignored source and captures HEAD.
Reject concurrent edits. Generated OKF and ignored assets are outputs; protect
OKF sources, builders and Go embeds.

The development launcher owns a profile-local build receipt. Reuse requires
matching HEAD and tracked/non-ignored source bytes (including dirty files),
dependency contents, toolchains, target and build settings, and byte-verified
Desktop output plus immutable Runtime bundle. Missing, altered or incomplete
outputs rebuild; failed preparation never launches a previous bundle. Concurrent
source/input changes fail before launch. A newly installed pinned Rust toolchain
is the only admitted preparation-time toolchain transition.

`--rebuild` forces build preparation; `REDEVEN_AGENT_FORCE_INSTALL=1` reinstalls
all three JavaScript packages once and forces preparation. Package manifests
select pnpm or npm; successful install receipts bind manifests, selected locks
and toolchain identity. Compatibility lockfiles do not select a second installer.
The first launch after this change installs once to establish these receipts.

Development Rust staging may reuse profile-owned Cargo registry/target caches,
while installing the exact locked published crate into fresh staging. Digest,
executable and consumption checks still run and product evidence is regenerated.
Release staging always has isolated Cargo directories. Source changes conservatively
rebuild the full product; this is not per-component or watch-mode compilation.
Saved local Gateways retain current-source installation and lifecycle. Their
verified package archives persist only within a cache generation bound to the
launcher's complete build input key, including dirty source bytes. Different
inputs discard the previous generation; calls without an input key use a fresh
session cache. Archive verification remains owned by the package cache.

Development launches select gzip level 1 and Brotli quality 4 for embedded assets;
decompression yields the original bytes. Ordinary/release builds default to
maximum compression. The selected profile participates in build identity.
Gateway source copies exclude unrelated agent worktrees and native build caches.

Logs report dependency, input verification, Desktop, Runtime and Gateway timings,
Gateway preparation phases, and total preparation before opening the window.
A warm empty-profile launch is not an end-to-end latency claim for source changes
or saved Gateways. Qualify both rebuilt and unchanged launches with a local
Gateway, checking the current Runtime commit and owned-service cleanup.

Normal exit, startup failure, Ctrl+C and SIGTERM stop owned local services.
The launcher owns coordination; product shutdown semantics remain unchanged.

Shared Electron resolution returns only the path; installer logs use stderr.
Propagate failures and check executability after dependency-changing builds.

## Credentials
Unpackaged development instances use AES-256-GCM with a random profile key
(0600). Keep the key with the profile. It prevents plaintext disclosure, not
same-user process access. Other launches use Electron system storage; codec
construction never probes it.

Legacy Keychain records open a recovery screen without system access or preference
recovery. Only its explicit migration action decrypts and atomically migrates each
file. Failure preserves credentials and permits retry/quit; corrupt keys require
repair. Never reset accounts, Runtime state or Keychain entries.

## Bundle retention
Complete bundles publish under `<development-state-root>/desktop/bundles/<manifest-sha256>`.
Retain the newest three, selected bundle (including reuse), and all live references.
This bounds inactive verified package counts, not bytes; active or unverified
entries can increase usage.

# Boundaries

Retention only touches generated packages in the selected profile. Builders own
in-progress directories.

# Evidence

- `redeven:scripts/dev_desktop.sh` - Publication, launch and cleanup.
- `redeven:scripts/dev_desktop_build_cache.test.mjs` - Input drift, corruption and toolchain admission.
- `redeven:scripts/ui_package_install.test.mjs` - Manager selection, repeat installs and failure.
- `redeven:scripts/redevplugin_build_cache.test.mjs` - Development reuse and release isolation.
- `redeven:scripts/source_build_identity.mjs` - Mixed-source rejection.
- `redeven:scripts/desktop_bundle_build_contract.test.mjs` - Source and staging boundaries.
- `redeven:scripts/dev_desktop_signal_cleanup_test.sh` - Exit, download and reinstall cleanup.
- `redeven:desktop/src/main/developmentSecretStorage.test.ts` - Restart, migration, failures, tags and permissions.
- `redeven:desktop/scripts/check-development-credentials.mjs` - Real-product restarts, Env App, damaged keys and cleanup.
