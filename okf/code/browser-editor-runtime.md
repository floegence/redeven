---
type: Runtime Contract
title: Browser Editor runtime
tags: [code-app, browser-editor, local-ui, desktop]
quality_exception: Cross-surface Browser Editor contract spanning Code App runtime state, Desktop transfer, Env App orchestration, remote download validation, and codespace navigation security.
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Code App owns Browser Editor runtime. Local UI `/cs/<id>/` and remote `cs-*` hosts open codespaces; Desktop/Env App use workspace-engine APIs to prepare/update versions. Setup is single-flight, and exact operation identities fence late progress, cancellation and transferred chunks.

# Contract

## Mechanism
Code App owns lifecycle, ports, status, setup, transfer chunks, versions and cancellation. Setup is single-flight; accepted IDs cannot be reused within RuntimeManager lifetime. Stale chunks, completion, cancellation or progress cannot alter another operation.

Shell owns Browser Editor orchestration, Desktop delivery, progress and cancellation state across page replacement. Pages own optional follow-on opening. Explicit Cancel requests cancellation; environment retirement only aborts observation/transport. New views reuse pending preparation and cannot start duplicates. External browser opens retain the Local UI or remote launcher flow.

# Boundaries

Desktop bridge bootstrap values belong to the current isolated app origin. They cannot grant runtime permission or replace source, origin and capability validation.

# Evidence

- `redeven:internal/codeapp/appserver/server.go:80` - Source.
