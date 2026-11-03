---
type: Release Contract
title: OKF release assets
tags: [release, security, supply-chain, okf]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Releases distribute OKF manifest and SHA256 verification assets alongside CLI/Desktop packages and signed SHA256SUMS. The signed aggregate remains their public integrity anchor; standalone verification files never replace authenticated release checksums or source provenance.

# Contract

## Mechanism
Build jobs copy the OKF verification files into per-platform package artifacts. The release job recollects them, includes them in `SHA256SUMS`, signs the checksum file with Cosign keyless OIDC, and uploads the OKF files as standalone GitHub Release assets.

# Boundaries

Downstream verification relies on releases containing both the standalone OKF verification files and the signed aggregate checksum set.

# Evidence

- `redeven:.github/workflows/release.yml:51` - Source.
