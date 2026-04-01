# Knowledge Bundle Maintenance

This document explains how Redeven's embedded knowledge bundle is authored, refreshed, verified, and shipped.

## What ships

Redeven has two knowledge directories with different roles:

- `internal/knowledge/source/` is the authoring source of truth.
- `internal/knowledge/dist/` is the generated verification artifact set consumed by `go:embed` and release packaging.

The runtime and AI stack read the embedded bundle from the compiled binary. The checked-in `dist` files exist so maintainers and release consumers can verify that the embedded payload was produced from the current curated source.

## Source layout

`internal/knowledge/source/` contains:

- `manifest.yaml` for bundle metadata, allowed repos, and provenance refs.
- `cards/*.md` for individual knowledge cards.
- `indices/topic_index.yaml` for topic-to-card lookup.
- `indices/code_index.yaml` for code-path-to-card lookup.

Each card is a Markdown file with YAML frontmatter plus the required sections:

- `Conclusion`
- `Mechanism`
- `Boundaries`
- `Evidence`
- `Invalid Conditions`

Evidence entries use this format:

```text
- <repo>:<path>:<line> - <note>
```

Allowed repos are currently:

- `redeven`
- `floe-webapp`
- `floeterm`
- `flowersec`

## Provenance model

`source_refs` in `manifest.yaml` should record the exact commits audited for this refresh.

Important maintenance rule:

- The knowledge builder does not clone or fetch sibling repositories for you.

Maintainers are expected to inspect the real source locally, then encode the verified conclusions into `cards/*.md`, `topic_index.yaml`, and `code_index.yaml`.

For a normal refresh in this workspace, that means auditing:

- `../redeven`
- `../floe-webapp`
- `../floeterm`
- `../flowersec`

## Build and verification flow

Knowledge generation happens at build time, not at runtime.

1. `./scripts/build_assets.sh` invokes `./scripts/build_knowledge_bundle.sh`.
2. `./scripts/build_knowledge_bundle.sh` runs `go run ./cmd/knowledge-bundle`.
3. The builder parses source cards and indices, validates references, hashes the source tree, and writes:
   - `internal/knowledge/dist/knowledge_bundle.json`
   - `internal/knowledge/dist/knowledge_bundle.manifest.json`
   - `internal/knowledge/dist/knowledge_bundle.sha256`
4. `internal/knowledge/embed.go` embeds the bundle and manifest into the runtime binary.

CI keeps both sides honest:

- `./scripts/knowledge/check_source_integrity.sh` validates source shape.
- `./scripts/build_knowledge_bundle.sh --verify-only` rejects stale checked-in dist files.

## Refresh checklist

1. Create a dedicated worktree. Never refresh knowledge on `main`.
2. Audit current code in Redeven and sibling repos.
3. Update `manifest.yaml`:
   - bump `updated_at`
   - pin `source_refs` to the commits you actually audited
4. Rewrite cards and indices to match current code, not historical assumptions.
5. Run:

```bash
./scripts/knowledge/check_source_integrity.sh
./scripts/build_knowledge_bundle.sh
```

6. If you only want to confirm the checked-in dist is still fresh, run:

```bash
./scripts/build_knowledge_bundle.sh --verify-only
```

## Release contract

Release workflow uploads these standalone knowledge verification files:

- `knowledge_bundle.manifest.json`
- `knowledge_bundle.sha256`

It also includes both files in `SHA256SUMS`, then signs `SHA256SUMS` with Cosign keyless OIDC. That makes the knowledge bundle auditable from the public GitHub Release without requiring access to private build infrastructure.
