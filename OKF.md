# OKF Bundle

Redeven uses Open Knowledge Format (OKF) v0.1 for the embedded repository knowledge corpus consumed by AI tooling.

The authoring root is `internal/okf/source/`. Its root `index.md` declares `okf_version: "0.1"`, and every non-reserved Markdown file is an OKF concept with required YAML frontmatter containing `type`.

Generated artifacts live in `internal/okf/dist/`:

- `okf_bundle.json`
- `okf_bundle.manifest.json`
- `okf_bundle.sha256`

Build and verify:

```bash
./scripts/okf/check_source_integrity.sh
./scripts/build_okf_bundle.sh --verify-only
```

To regenerate the checked-in dist artifacts:

```bash
./scripts/build_okf_bundle.sh
```

Runtime and AI code expose the embedded corpus only through `okf.search`; the previous knowledge command, tool name, source tree, and release artifact names are intentionally removed.
