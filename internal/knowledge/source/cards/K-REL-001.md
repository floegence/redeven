---
id: K-REL-001
version: 2
title: Release workflow publishes knowledge verification assets alongside CLI and desktop artifacts
status: stable
owners:
  - deployment
tags:
  - release
  - security
  - supply_chain
source_card_id: K-REL-001
---

## Conclusion

GitHub releases ship `knowledge_bundle.manifest.json` and `knowledge_bundle.sha256` together with CLI tarballs, desktop packages, and signed `SHA256SUMS`.

## Mechanism

Build jobs copy the knowledge verification files into per-platform package artifacts. The release job recollects them, includes them in `SHA256SUMS`, signs the checksum file with Cosign keyless OIDC, and uploads the knowledge files as standalone GitHub Release assets.

## Boundaries

Downstream verification relies on releases containing both the standalone knowledge verification files and the signed aggregate checksum set.

## Evidence

- redeven:.github/workflows/release.yml:49 - Build jobs collect the knowledge manifest and sha files into dist.
- redeven:.github/workflows/release.yml:77 - Package artifacts upload those knowledge files alongside CLI tarballs.
- redeven:.github/workflows/release.yml:255 - The release job recopies downloaded knowledge verification assets into dist.
- redeven:.github/workflows/release.yml:270 - SHA256SUMS includes knowledge bundle manifest and sha files.
- redeven:.github/workflows/release.yml:279 - Release checksums are signed with Cosign keyless OIDC.
- redeven:.github/workflows/release.yml:347 - GitHub release upload includes the knowledge verification files.

## Invalid Conditions

This card becomes invalid if releases stop shipping knowledge verification assets, omit them from `SHA256SUMS`, or stop signing the release checksum set.
