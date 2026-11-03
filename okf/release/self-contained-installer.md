---
type: Release Contract
title: Self-contained installer distribution
tags: [release, installer, security, runtime]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Release builds macOS/Linux amd64/arm64 self-contained installers without CGO and renders entry from exact binary digests, all signed via SHA256SUMS. Receiving hosts need no Go/Cosign/Python/OpenSSL/package manager, but require shell, HTTPS downloader and SHA256 utility.

# Contract

## Trust and acquisition
The HTTPS bootstrap is the initial trust boundary. Its reviewed fixed digest authenticates the installer before execution. Upstream Cosign Blob API verifies exact repository workflow, OIDC issuer and tag through authenticated TUF roots, certificate transparency and Rekor. Accept detached .sig plus PEM/base 64 PEM only; no format guessing, mutable trust overrides, disabled verification or fabricated markers. Signature/digest failure never executes Runtime.

TUF requests are cancellable/time-bounded without writing user trust cache. Bound log responses before SDK parsing and admit detached X.509 hashedrekord/0.0.1 only; reject OpenPGP-capable/other types before the general parser. Pass unchanged bytes to upstream cryptographic checks.

Default installation resolves GitHub latest unless an exact version is supplied. Explicit managed channel uses the public version manifest and GitHub-first sources; self-upgrade environment semantics remain. Automatic resolution cannot downgrade a known version; explicit rollback can.

## Activation transaction
A no-follow nonblocking lock serializes the root. Closed bounded archive membership rejects links, duplicates, traversal, missing/extra files, bad trailers and changed bytes. Published artifact-cache owns verified acquisition/storage.

Stage complete suites in .redeven-runtime-suites/<archive-sha256>, sync, read back digests/inventory/version and prepare pinned ripgrep before atomic redeven symlink replacement. Ripgrep 15.2.0 uses Linux musl archives on both architectures. New/reused executables must actually run and report that version; missing loader, timeout, wrong version or oversized output leaves prior activation unchanged. Detect concurrent changes; restore and verify prior entry after post-switch failure. Distinguish unchanged from committed-but-unconfirmed errors.

Retain published suites and legacy flat resources: live older processes can still need them after multiple upgrades. Installer owns no process lifetime, so removal needs an explicit unused/rollback assessment; disk usage grows with distinct archives.

Fresh install uses a writable user directory without implicit sudo. Idempotent bash/zsh/fish blocks update future PATH; print the current-shell command or direct path for unknown shells. Upgrade changes no shell profile and starts/restarts no service. Runtime owns maintenance/re-exec after success.

## Publication and promotion
From v0.13.13, authenticated redeven-installer-contract.json declares minimum installer, closed targets and archive contract; older installers stop before incompatible acquisition. Render GitHub and Portal bootstraps from one template and four actual installer hashes; sign both through aggregate checksums. Portal uses its official mirror fallback, not another implementation.

Publish assets with --latest=false. Before promotion, check-distribution authenticates inventory/contract and each bootstrap's complete digest, tag, channel and four pins without relying on the current default. After promotion, --check-active-entry requires GitHub byte equality; Portal authenticates its active bootstrap against its own signed release and candidate minimum installer, permitting an older recommended Runtime. Read back GitHub's default independently.

README selects generated GitHub bootstrap; The Portal UI and install endpoint redirect to the generated Portal entry under its channel contract. Redirects confer no signature trust. No placeholder hashes/missing assets may activate. Public deployment is explicit. Rollback selects compatible immutable signed releases, never obsolete external-tool installers or duplicated shell code. Historical upgrade/native execution/page integration remain explicit acceptance, outside ordinary push gates.

## Dependency security
Consume checksum-verified published Cosign/Rekor patches. Require go-jose >=4.1.6 and no imported legacy golang.org/x/crypto/openpgp packages; preserve identity, signing time, roots and transparency. Qualify official releases plus tampering/cross-tag denial. The distinct general SDK OpenPGP finding and its format-rejection boundary remain documented below; a nonzero scanner is never a clean audit.

# Boundaries

Verification is online; transparency or trust-service outages fail closed.
The bootstrap cannot defend against compromise of its original HTTPS script.
Cross-compilation alone does not certify execution on every target OS.

The dependency audit fixes the reviewed gRPC findings by selecting released
`v1.83.1`. The general SDK still imports the deprecated OpenPGP implementation
reported by `GO-2026-5932`; symbol scanning can continue to report it. The
installer rejects those input formats before SDK parsing. Do not describe a
nonzero scanner result as a clean audit, add a blanket suppression, or remove
this boundary without reviewing the upstream replacement and genuine fixtures.

# Evidence

- `redeven:internal/installer/signature.go:1` - Source.
- `redeven:internal/installer/install_test.go:1` - Tests.
