---
type: Release Contract
title: OKF release assets
description: Release workflow publishes OKF verification assets alongside CLI and desktop artifacts.
tags: [release, security, supply-chain, okf]
timestamp: 2026-06-17T00:00:00Z
---

GitHub releases ship `okf_bundle.manifest.json` and `okf_bundle.sha256` together with CLI tarballs, desktop packages, and signed `SHA256SUMS`.

# Mechanism

Build jobs copy the OKF verification files into per-platform package artifacts. The release job recollects them, includes them in `SHA256SUMS`, signs the checksum file with Cosign keyless OIDC, and uploads the OKF files as standalone GitHub Release assets.

# Boundaries

Downstream verification relies on releases containing both the standalone OKF verification files and the signed aggregate checksum set.

# Citations

[1] redeven:.github/workflows/release.yml:49 - Build jobs collect the OKF manifest and sha files into dist.
[2] redeven:.github/workflows/release.yml:77 - Package artifacts upload those OKF files alongside CLI tarballs.
[3] redeven:.github/workflows/release.yml:255 - The release job recopies downloaded OKF verification assets into dist.
[4] redeven:.github/workflows/release.yml:270 - SHA256SUMS includes OKF bundle manifest and sha files.
[5] redeven:.github/workflows/release.yml:279 - Release checksums are signed with Cosign keyless OIDC.
[6] redeven:.github/workflows/release.yml:347 - GitHub release upload includes the OKF verification files.
