---
id: K-KNOW-001
version: 1
title: Knowledge bundle build path is deterministic and source-driven
status: stable
owners:
  - ai
tags:
  - knowledge
  - release
source_card_id: K-KNOW-001
---

## Conclusion

Knowledge bundle artifacts are built directly from checked-in source files without local model generation.

## Mechanism

The build script invokes the bundle command with source and dist roots, and the command supports source validation plus deterministic bundle verification/write behavior.

## Boundaries

Reintroducing model-generated intermediate artifacts into the release path would break determinism and make bundle provenance harder to audit.

## Evidence

- redeven-agent:scripts/build_assets.sh:112 - Asset build includes a dedicated knowledge bundle stage.
- redeven-agent:scripts/build_knowledge_bundle.sh:23 - Bundle script calls cmd/knowledge-bundle with source root.
- redeven-agent:cmd/knowledge-bundle/main.go:14 - Bundle command defaults to internal knowledge source directory.
- redeven-agent:cmd/knowledge-bundle/main.go:17 - Bundle command supports source-only validation and dist verification modes.

## Invalid Conditions

This card becomes invalid if release-critical knowledge artifacts depend on ad-hoc local model generation instead of deterministic source compilation.
