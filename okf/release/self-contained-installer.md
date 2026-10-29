---
type: Release Contract
title: Self-contained installer distribution
tags: [release, installer, security, runtime]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Release packaging builds `redeven-installer_<os>_<arch>` for macOS and Linux,
AMD64 and ARM64, with CGO disabled. It renders `redeven-install.sh` from the
actual four binary digests and signs both the binaries and entry through
`SHA256SUMS`. No receiving-host Go, Cosign, Python, OpenSSL or package manager
is required. A standard shell, HTTPS downloader and SHA-256 utility remain
bootstrap prerequisites.

# Contract

## Trust and failure boundaries

The original HTTPS script is the initial trust boundary. A reviewed fixed
installer digest authenticates the executable before it runs. The executable
uses the upstream Cosign Blob API, authenticated TUF roots, certificate
transparency and Rekor evidence to verify the exact repository workflow, OIDC
issuer and requested tag. It accepts detached `.sig` plus PEM or base64 PEM;
it does not guess a bundle format, accept mutable trust overrides, disable
verification, or fabricate upstream verification markers.

TUF requests preserve cancellation, use bounded HTTP timeouts and do not write
the user's trust cache. Log responses are bounded before SDK parsing and admit
only the detached X.509 `hashedrekord/0.0.1` contract. Other log types, including
legacy OpenPGP-capable formats, fail before the general upstream parser.
The bytes passed to the SDK are unchanged; the SDK owns cryptographic checks.
Signature or digest failure never executes the downloaded Runtime.

Public installation discovers GitHub's latest release unless an exact Runtime
version is supplied. The explicit managed channel selects the public version
manifest and GitHub-first artifact sources; it does not affect the public
default. The existing Runtime self-upgrade environment contract is retained.
Automatic resolution cannot downgrade a known installed version. Explicit
versions can request a rollback.

## Installation transaction

A no-follow, nonblocking lock serializes an activation root. Product-selected
regular archive members are closed and bounded; links, duplicates, traversal,
unexpected files, missing components, invalid trailers and changed bytes fail.
Published artifact-cache code owns acquisition and digest-checked storage.

Complete suites live in `.redeven-runtime-suites/<archive-sha256>`. Staging,
file synchronization, inventory/digest/version readback and pinned ripgrep
preparation precede the atomic `redeven` symlink switch. Ripgrep 15.2.0 uses
musl archives on both Linux targets; every new or reused authenticated executable
must run and report the exact required version before its link or Runtime is
activated. A missing loader, execution failure, wrong version, oversized output
or deadline failure leaves the previous Runtime activation unchanged. Activation detects
concurrent changes, retains every published suite, and restores and
checks the prior entry when post-switch verification fails. Errors distinguish
an unchanged activation from a committed but unconfirmed change.

Unselected suites and legacy flat-layout resource files are not automatically
removed: a still-running older Runtime can need its original resources after
one or multiple newer installations. The installer
does not own process lifetime and cannot prove those suites unused. Disk usage
therefore grows with distinct installed archives; removal requires a separate
explicit decision after confirming no process or rollback still needs them.

Fresh installs use a writable per-user directory without implicit sudo.
PATH updates use idempotent managed bash, zsh or fish blocks; the current shell
still needs the printed command. Unknown shells receive a direct executable
path. Upgrade mode does not edit shell profiles, start services or restart
Runtime; Runtime owns maintenance and re-exec after installer success.

## Publication and entry selection

From `v0.13.13`, the authenticated `redeven-installer-contract.json` declares
the minimum installer, closed targets and Runtime archive contract. Older
installers must stop before acquiring a new incompatible payload.

One bootstrap template is rendered from the four actual installer build
hashes. Release signing covers both `redeven-install.sh` (GitHub channel) and
`redeven-install-portal.sh` (Portal channel with the official mirror fallback).
There is no separately maintained shell installation implementation.

Release publication is separate from default-version promotion: assets are
published with `--latest=false`. Before promotion, `check-distribution`
authenticates the candidate inventory and contract, verifies each bootstrap's
whole-file digest, own release tag, channel and four installer pins. This
immutable candidate check does not depend on the current default pointer.
After promotion, `--check-active-entry` additionally reads back the public
entry: GitHub must match the authenticated candidate bytes; Portal authenticates
the active bootstrap against its own signed release and checks the candidate
Runtime's minimum installer version, allowing an older recommended Runtime.
GitHub's default
pointer is read back separately.

Runtime README commands select the generated GitHub release bootstrap. Portal's
Console and Install Worker redirect to the generated Portal bootstrap, using
one Portal-owned channel contract. That redirect is routing, not signature
verification. Bootstrap hashes are derived only from real release builds; no
placeholder pins or absent assets may be publicly activated. Public deployment
is an explicit operation, not a side effect of delivering source changes.
Rollback selects another compatible immutable signed release; it never restores
an obsolete external-tool installer or a duplicated rollback shell source.
Installation, historical upgrade, native execution and page integration are
independent feature/release acceptance, not additional ordinary push gates.

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

- `redeven:internal/installer/signature.go:1` - Exact identity, authenticated roots and upstream signature verification.
- `redeven:internal/installer/install_test.go:1` - Consecutive activations preserve a live older process's resource access.
