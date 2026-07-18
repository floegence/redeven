---
type: OKF Lifecycle
title: OKF bundle lifecycle
description: Redeven builds a deterministic embedded OKF bundle from source Markdown concepts.
tags: [okf, provenance, release]
timestamp: 2026-06-17T00:00:00Z
---
# Summary

Redeven builds its embedded OKF bundle from curated source files under the top-level `okf/` authoring root, verifies deterministic dist outputs under `okf/dist/`, and embeds the resulting bundle into the binary used by runtime and AI features.

Redeven builds a deterministic embedded OKF bundle from source Markdown concepts.

# Contract

## Mechanism

`build_assets.sh` invokes `build_okf_bundle.sh`, which runs `cmd/okf-bundle` against explicit source and dist roots. The builder scans OKF Markdown concepts, parses Summary, Contract, Boundaries, section metadata, and structured Evidence, skips generated `dist/` while hashing the source tree into `source_sha256`, and writes the bundle, manifest, and checksum outputs. The schema 3 manifest records concept, section, and evidence counts.

Authoring quality uses the same parser and builder rather than a second Markdown implementation. `check_content_quality.sh --report-only` reports legacy layout, index coverage, summary budgets, oversized contracts, evidence problems, and duplicate paragraphs without blocking migration. `--strict` turns structural, indexing, invalid evidence, duplicate large-paragraph, and over-budget violations into failures. The final integration gate runs strict quality after source integrity and before verifying the generated bundle.

Each source concept is a retrieval unit with Summary, Contract, Boundaries, and Evidence. Summary and section bodies are embedded as structured data; Evidence remains in the same source file but is omitted from ordinary concept opening unless explicitly requested. `okf/dist/*` is regenerated from the source tree and remains committed verification output rather than an authoring surface.

# Boundaries

The bundle remains auditable only while OKF Markdown concepts are the sole authoring surface, quality rules are enforced through the shared parser, and `okf/dist/*` stays a generated verification artifact set rather than hand-edited truth. A `quality_exception` may document a justified cross-domain length exception, but it does not disable structural, evidence, indexing, or duplicate-content checks.

# Evidence

- `redeven:scripts/build_assets.sh:53` - Embedded asset builds include the OKF bundle stage.
- `redeven:scripts/build_okf_bundle.sh:19` - Bundle script resolves `okf` as source root and `okf/dist` as dist root.
- `redeven:cmd/okf-bundle/main.go:14` - The standalone bundle command defaults to the top-level OKF source root.
- `redeven:cmd/redeven/okf.go:39` - The main CLI exposes `redeven okf bundle` with the same default roots.
- `redeven:internal/okf/builder.go:22` - BuildFromSource assembles the bundle from OKF concepts.
- `redeven:okf/dist/embed.go:7` - Top-level dist files are embedded by the `okf/dist` package.
- `redeven:internal/okf/embed.go:6` - Internal runtime OKF loading reads through the top-level embedded dist package.
- `redeven:scripts/okf/check_source_integrity.sh:5` - Integrity checks validate the top-level OKF source before generated artifacts are trusted.
- `redeven:scripts/okf/check_content_quality.sh:1` - Content quality exposes report-only and strict validation through the existing bundle command.
- `redeven:internal/okf/quality.go:1` - Quality validation checks layout, budgets, Evidence, index coverage, and duplicate paragraphs.
