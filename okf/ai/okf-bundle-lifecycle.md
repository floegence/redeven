---
type: OKF Lifecycle
title: OKF bundle lifecycle
description: Redeven builds a deterministic embedded OKF bundle from source Markdown concepts.
tags: [okf, provenance, release]
timestamp: 2026-06-17T00:00:00Z
---

Redeven builds its embedded OKF bundle from curated source files under the top-level `okf/` authoring root, verifies deterministic dist outputs under `okf/dist/`, and embeds the resulting bundle into the binary used by runtime and AI features.

# Mechanism

`build_assets.sh` invokes `build_okf_bundle.sh`, which runs `cmd/okf-bundle` against explicit source and dist roots. The builder scans OKF Markdown concepts, validates required frontmatter and reserved filenames, skips generated `dist/` while hashing the source tree into `source_sha256`, writes bundle plus manifest plus sha outputs, CI validates source integrity and stale dist, and top-level `go:embed` makes the bundle available to runtime search code.

# Boundaries

The bundle remains auditable only while OKF Markdown concepts are the sole authoring surface and `okf/dist/*` stays a generated verification artifact set rather than hand-edited truth.

# Citations

[1] redeven:scripts/build_assets.sh:53 - Embedded asset builds include the OKF bundle stage.
[2] redeven:scripts/build_okf_bundle.sh:19 - Bundle script resolves `okf` as source root and `okf/dist` as dist root.
[3] redeven:cmd/okf-bundle/main.go:14 - The standalone bundle command defaults to the top-level OKF source root.
[4] redeven:cmd/redeven/okf.go:39 - The main CLI exposes `redeven okf bundle` with the same default roots.
[5] redeven:internal/okf/builder.go:22 - BuildFromSource assembles the bundle from OKF concepts.
[6] redeven:internal/okf/builder.go:99 - VerifyDistFiles rejects stale checked-in dist artifacts.
[7] redeven:internal/okf/builder.go:116 - Source tree hashing skips generated `dist/` and dot directories.
[8] redeven:okf/dist/embed.go:7 - Top-level dist files are embedded by the `okf/dist` package.
[9] redeven:internal/okf/embed.go:6 - Internal runtime OKF loading reads through the top-level embedded dist package.
[10] redeven:scripts/okf/check_source_integrity.sh:5 - Integrity checks validate the top-level OKF source before generated artifacts are trusted.
