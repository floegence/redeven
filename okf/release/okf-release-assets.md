---
type: Release Contract
title: OKF release assets
description: Release workflow publishes OKF verification assets alongside CLI and desktop artifacts.
tags: [release, security, supply-chain, okf]
timestamp: 2026-06-17T00:00:00Z
---
# Summary

GitHub releases ship `okf_bundle.manifest.json` and `okf_bundle.sha256` together with CLI tarballs, desktop packages, and signed `SHA256SUMS`.

Release workflow publishes OKF verification assets alongside CLI and desktop artifacts.

The signed aggregate checksum remains the public integrity anchor for these standalone verification files.

# Contract

## Mechanism

Build jobs copy the OKF verification files into per-platform package artifacts. The release job recollects them, includes them in `SHA256SUMS`, signs the checksum file with Cosign keyless OIDC, and uploads the OKF files as standalone GitHub Release assets.

# Boundaries

Downstream verification relies on releases containing both the standalone OKF verification files and the signed aggregate checksum set.

# Evidence

- `redeven:.github/workflows/release.yml:51` - Release builds embedded assets before packaging binaries.
