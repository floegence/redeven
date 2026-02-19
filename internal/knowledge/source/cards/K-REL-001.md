---
id: K-REL-001
version: 1
title: Release pipeline ships and mirrors knowledge bundle verification assets
status: stable
owners:
  - deployment
tags:
  - release
  - security
source_card_id: K-REL-001
---

## Conclusion

Release builds publish knowledge bundle manifest and checksum files, and mirror sync verifies uploaded assets before declaring success.

## Mechanism

Release workflow collects bundle verification files into artifacts, signs combined checksums, and R2 sync script re-downloads mirrored files to confirm byte-level integrity.

## Boundaries

If manifest/checksum artifacts are omitted or mirror verification is skipped, downstream installers lose auditable integrity guarantees.

## Evidence

- redeven-agent:.github/workflows/release.yml:49 - Release build collects knowledge bundle assets.
- redeven-agent:.github/workflows/release.yml:109 - Release checksums include bundle manifest and hash files.
- redeven-agent:scripts/sync_release_assets.sh:85 - Mirror sync requires knowledge bundle verification assets.
- redeven-agent:scripts/sync_release_assets.sh:147 - Mirror sync re-downloads uploaded files for integrity checks.

## Invalid Conditions

This card becomes invalid if release or mirror workflows stop publishing or validating knowledge bundle verification artifacts.
