---
type: Release Contract
title: Self-contained installer distribution
description: Pin a prebuilt installer, authenticate detached release evidence in process, and activate a complete Runtime suite atomically.
tags: [release, installer, security, runtime]
timestamp: 2026-10-20T00:00:00Z
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
The original HTTPS script is the initial trust boundary.

TUF requests preserve cancellation, use bounded HTTP timeouts and do not write the user's trust cache.

Explicit versions can request a rollback.

## Installation transaction
A no-follow, nonblocking lock serializes an activation root. Product-selected regular archive members are closed and bounded; links, duplicates, traversal, unexpected files, missing components, invalid trailers and changed bytes fail.

Upgrade mode does not edit shell profiles, start services or restart Runtime; Runtime owns maintenance and re-exec after installer success.

## Publication and entry cutover
From `v0.13.13`, the authenticated `redeven-installer-contract.json` declares the minimum installer, closed targets and Runtime archive contract. Older installers must stop before acquiring a new incompatible payload.

Installation, historical upgrade and lifecycle qualification remain separate from a successful metadata readiness check.

# Boundaries

Verification is online; transparency or trust-service outages fail closed.

Do not describe a nonzero scanner result as a clean audit, add a blanket suppression, or remove this boundary without reviewing the upstream replacement and genuine fixtures.

# Evidence

- `redeven:internal/installer/signature.go:1` - Exact identity, authenticated roots and upstream signature verification.

- `redeven:internal/installer/rekor.go:1` - Bounded, unchanged X.509 log input admission.

- `redeven:internal/installer/install.go:1` - Verify-before-execute controller and upgrade ownership.
