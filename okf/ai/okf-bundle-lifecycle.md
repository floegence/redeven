---
type: OKF Lifecycle
title: OKF bundle lifecycle
description: Redeven builds a deterministic embedded OKF bundle from source Markdown concepts.
tags: [okf, provenance, release]
timestamp: 2026-10-07T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven builds its embedded OKF bundle from curated source files under the top-level `okf/` authoring root, verifies deterministic dist outputs under `okf/dist/`, and embeds the resulting bundle into the binary used by Runtime and AI features for local retrieval.

# Contract

## Mechanism
`build_assets.sh` invokes `build_okf_bundle.sh`, which runs `cmd/okf-bundle` against explicit source and dist roots. The builder emits the bundle, manifest and checksum deterministically. Summary and section bodies are embedded as structured data; Evidence remains in its source file but is omitted from ordinary concept opening unless requested. `okf/dist/*` is generated from source and is never an authoring surface.

## Quality gates
Report mode exposes layout, indexing, summary, evidence, duplication, lifecycle and budget issues without blocking cleanup. Strict mode fails structural and source-integrity violations, overdue reviews, and source totals above the hard cap. Final integration runs strict content quality after source integrity and before verifying the generated bundle.

## Source budget
Count Unicode characters in every source Markdown file under `okf/`, including the index and log, after CRLF-to-LF normalization; exclude `okf/dist/`. The report shows total, remaining capacity and index/concept/log usage. Exceeding 900,000 warns; strict quality accepts exactly 1,000,000 and fails above it. A per-concept `quality_exception` cannot waive this hard cap.

## Review and log lifecycle
Every concept declares `lifecycle` and `reviewed_at`: review contracts every 180 days, active measurements and operational evidence every 90 days, and retained history every 365 days. Retained history also needs a concise `retention_reason`. Report mode warns and strict mode fails on invalid or overdue metadata; expiry prompts review and never deletes a document automatically. Keep `log.md` to compact summaries from the last 30 days after durable knowledge moves into its concept.

## Index and retention
Keep categories and concept links in the index; the parser derives each retrieval summary from the concept's `# Summary`. Prefer an existing concept, preserve only decision-relevant historical conclusions and counterevidence, and remove obsolete detail from the current tree so Git history remains the recovery path.

# Boundaries

The bundle remains auditable only while OKF Markdown concepts are the sole authoring surface, source and lifecycle budgets are enforced through the shared parser, and `okf/dist/*` stays a generated verification artifact set rather than hand-edited truth. A `quality_exception` may document a justified per-concept length exception, but it never waives the source cap or other quality checks.

# Evidence

- `redeven:scripts/build_assets.sh:53` - Embedded asset builds include the OKF bundle stage.

- `redeven:internal/okf/quality.go:1` - Enforces source character and lifecycle checks.
