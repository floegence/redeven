---
type: OKF Lifecycle
title: OKF bundle lifecycle
description: Redeven builds a deterministic embedded OKF bundle from source Markdown concepts.
tags: [okf, provenance, release]
timestamp: 2026-06-17T00:00:00Z
---

Redeven builds its embedded OKF bundle from curated source files under `internal/okf/source`, verifies deterministic dist outputs, and embeds the resulting bundle into the binary used by runtime and AI features.

# Mechanism

`build_assets.sh` invokes `build_okf_bundle.sh`, which runs `cmd/okf-bundle` against explicit source and dist roots. The builder scans OKF Markdown concepts, validates required frontmatter and reserved filenames, hashes the source tree into `source_sha256`, writes bundle plus manifest plus sha outputs, CI validates source integrity and stale dist, and `go:embed` makes the bundle available to runtime search code.

# Boundaries

The bundle remains auditable only while OKF Markdown concepts are the sole authoring surface and `internal/okf/dist/*` stays a generated verification artifact set rather than hand-edited truth.

# Citations

[1] redeven:scripts/build_assets.sh:53 - Embedded asset builds include the OKF bundle stage.
[2] redeven:scripts/build_okf_bundle.sh:19 - Bundle script resolves dedicated source and dist roots under internal/okf.
[3] redeven:cmd/okf-bundle/main.go:20 - Bundle command rebuilds from source before validate, verify, or write modes.
[4] redeven:internal/okf/builder.go:22 - BuildFromSource assembles the bundle from OKF concepts.
[5] redeven:internal/okf/builder.go:49 - Source tree hashing is recorded as source_sha256 provenance.
[6] redeven:internal/okf/builder.go:131 - VerifyDistFiles rejects stale checked-in dist artifacts.
[7] redeven:internal/okf/embed.go:8 - okf_bundle.json and its manifest are embedded into the Go binary.
[8] redeven:internal/okf/search.go:38 - Runtime search loads the embedded bundle lazily from embed FS.
[9] redeven:scripts/okf/check_source_integrity.sh:7 - Integrity checks validate the OKF source before generated artifacts are trusted.
[10] redeven:.github/workflows/ci-check.yml:26 - CI runs source integrity plus dist verification on every main and PR check.
