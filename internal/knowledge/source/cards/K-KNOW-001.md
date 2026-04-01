---
id: K-KNOW-001
version: 2
title: Knowledge bundle source is curated, deterministic, and embedded into the runtime binary
status: stable
owners:
  - ai
tags:
  - knowledge
  - provenance
  - release
source_card_id: K-KNOW-001
---

## Conclusion

Redeven builds its knowledge bundle from curated source files under `internal/knowledge/source`, verifies deterministic dist outputs, and embeds the resulting bundle into the binary used by runtime and AI features.

## Mechanism

`build_assets.sh` invokes `build_knowledge_bundle.sh`, which runs `cmd/knowledge-bundle` against explicit source and dist roots. The builder loads the manifest, cards, and indices, hashes the full source tree into `source_sha256`, writes bundle plus manifest plus sha outputs, CI validates source integrity and stale dist, and `go:embed` makes the bundle available to runtime search code.

## Boundaries

The bundle remains auditable only while source cards are the sole authoring surface and `internal/knowledge/dist/*` stays a generated verification artifact set rather than hand-edited truth.

## Evidence

- redeven:scripts/build_assets.sh:53 - Embedded asset builds always include the knowledge bundle stage.
- redeven:scripts/build_knowledge_bundle.sh:19 - Bundle script resolves dedicated source and dist roots under internal/knowledge.
- redeven:cmd/knowledge-bundle/main.go:20 - Bundle command always rebuilds from source before validate, verify, or write modes.
- redeven:internal/knowledge/builder.go:22 - BuildFromSource assembles the bundle from manifest, cards, and indices.
- redeven:internal/knowledge/builder.go:49 - Source tree hashing is recorded as source_sha256 provenance.
- redeven:internal/knowledge/builder.go:131 - VerifyDistFiles rejects stale checked-in dist artifacts.
- redeven:internal/knowledge/embed.go:8 - knowledge_bundle.json and its manifest are embedded into the Go binary.
- redeven:internal/knowledge/search.go:38 - Runtime search loads the embedded bundle lazily from embed FS.
- redeven:scripts/knowledge/check_source_integrity.sh:7 - Integrity checks require the source manifest and index files before validation.
- redeven:.github/workflows/ci-check.yml:26 - CI runs source integrity plus dist verification on every main and PR check.

## Invalid Conditions

This card becomes invalid if build-time knowledge starts depending on ad-hoc model output, if checked-in dist diverges from source without verification failures, or if runtime stops using embedded bundle assets.
