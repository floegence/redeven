---
id: K-REL-001
version: 1
title: Release pipeline ships knowledge bundle verification assets
status: stable
owners:
  - deployment
tags:
  - release
  - security
source_card_id: K-REL-001
---

## Conclusion

Release builds publish knowledge bundle manifest and checksum files alongside release checksums and signatures.

## Mechanism

Release workflow collects bundle verification files into artifacts and signs combined checksums so downstream consumers can verify integrity from GitHub Release alone.

## Boundaries

If manifest/checksum artifacts are omitted, downstream installers lose auditable integrity guarantees.

## Evidence

- redeven:.github/workflows/release.yml:49 - Release build collects knowledge bundle assets.
- redeven:.github/workflows/release.yml:109 - Release checksums include bundle manifest and hash files.

## Invalid Conditions

This card becomes invalid if release workflows stop publishing knowledge bundle verification artifacts.
