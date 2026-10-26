---
type: Protocol Contract
title: Computer semantic snapshots
description: Normalize browser, AX and AT-SPI facts into bounded, revision-scoped semantic trees at the Runtime boundary.
tags: [ai, computer-use, accessibility, protocol]
timestamp: 2026-10-13T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-26"
---
# Summary

ComputerUseRuntime owns the model-visible semantic schema, version 2. Browser,
macOS AX and Linux AT-SPI collect native facts; Runtime validates and normalizes
one bounded tree. Relationships never point outside that tree. Unsupported
facts stay absent. Invalid protocol, protected fields or inconsistent graphs
produce a closed observation failure, discard content and preserve confirmed
input effects without replay. Existing target authority and privacy scans remain
mandatory; semantic metadata does not grant input or capture permission.

# Contract

## Snapshot and node identity
Observations include `semantic_schema_version: 2`, `document_id`, `roots`, `nodes`, `truncated`, optional `focus_ref`, `total` and `execution_mode`.

Browser role resolution scans the complete authorized AX scope independently of the bounded model observation. A unique control after node 1000 remains resolvable; a duplicate beyond the presentation boundary remains ambiguous. References still require document revision and fresh DOM/AX identity validation.

`children_truncated` marks exported nodes with omitted descendants, including Runtime byte pruning. It is not evidence of empty rows or virtualization. Agents can read a row or table subtree through `root_ref`; completeness claims require checking the returned truncation facts.

Both directions of every parent/child edge must agree. An observation describes the bounded returned tree, not an exhaustive view of every application node.

## Roles, states and relationships
One Runtime alias inventory owns normalization and canonical selector expansion.

An ignored or truncated target has no invented reference; a platform-computed name or safe description may still be available.

# Boundaries

## Privacy and output lifecycle
Adapters retain the existing sensitive-field, CAPTCHA, origin/application and revision checks before exposing content. Runtime additionally rejects secure AX subroles and password-text nodes, constrains types and sizes, and strips unknown metadata.

Confirmed actions survive an observation failure; failed content never enters model history and input is not replayed.

# Evidence

- `redeven:internal/ai/computer_semantic.go` - Runtime schema validation, role inventory, byte pruning and focus projection.

- `redeven:internal/ai/computer_semantic_test.go` - graph, relationship, state, diff, selector and privacy assertions.

- `redeven:internal/envapp/ui_src/scripts/computerBrowserPage.mjs` - Chromium native collection and frame references.
