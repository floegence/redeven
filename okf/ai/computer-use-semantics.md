---
type: Protocol Contract
title: Computer semantic snapshots
description: Normalize browser, AX and AT-SPI facts into bounded, revision-scoped semantic trees at the Runtime boundary.
tags: [ai, computer-use, accessibility, protocol]
timestamp: 2026-10-13T00:00:00Z
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

Observations include `semantic_schema_version: 2`, `document_id`, `roots`,
`nodes`, `truncated`, optional `focus_ref`, `total` and `execution_mode`.
References are opaque, target- and document-scoped identifiers. Browser frame
identity remains in `frame_id`; represented frame trees form separate roots.
Subtree observations make the requested node a root. A node includes `ref`,
optional `parent_ref`, `child_refs`, native `role` and `platform_role`, Runtime-
derived `canonical_role`, `name`, optional `description`, `value`, `bounds`,
`relations` and native subrole/action metadata, plus `states` and `actions`.
Single-node reads announce version 2 and normalize the same node fields; they
are local facts rather than a complete relationship graph.

Both directions of every parent/child edge must agree. Duplicate references,
cycles, unreachable nodes and dangling or duplicate relationship targets fail
validation. Runtime derives roots and strips unknown fields. There is no schema
v1 compatibility projection. Names, descriptions and text values are bounded to
2,000 Unicode code points; trees contain at most 1,000 nodes. Runtime exports at
most 256 KiB, pruning a parent-first prefix and all omitted edges when required.
Byte pruning marks `truncated`; selectors must not claim uniqueness from an
incomplete platform search. An observation describes the bounded returned tree,
not an exhaustive view of every application node.

## Roles, states and relationships

One Runtime alias inventory owns normalization and canonical selector expansion.
Unknown native roles become `other` while preserving their original spelling.
A canonical locator expands to explicit platform roles before dispatch; native
adapters retain their existing event waits and revalidation. Duplicate matches
remain ambiguous. Unknown canonical selectors fail rather than guessing.

States include `invalid`, `busy`, `required`, `expanded`, `checked`, `selected`,
`focused`, enabled/disabled, readonly and supported visibility/editability
facts. Boolean false differs from an unsupported omitted fact. `checked` may be
`mixed`; `invalid` may be `grammar` or `spelling` when the platform exposes it.
Chromium can project spelling invalidity as boolean true. Native focused flags
remain intact. `focus_ref` identifies the deepest focused node when flags form
one ancestor chain; unrelated focus claims leave that aggregate unspecified.

The limited relation keys are `labelled_by`, `described_by`, `controls`,
`details`, `error_message` and `active_descendant`, with at most 64 targets per
key. Only represented, platform-exposed targets are returned. An ignored or
truncated target has no invented reference; a platform-computed name or
safe description may still be available.

# Boundaries

## Privacy and output lifecycle

Adapters retain the existing sensitive-field, CAPTCHA, origin/application and
revision checks before exposing content. Runtime additionally rejects secure AX
subroles and password-text nodes, constrains types and sizes, and strips unknown
metadata. Invalid semantic output drops pixels, node content and page metadata.
These controls do not claim atomic knowledge of every third-party application.
The [takeover contract](computer-use-takeover.md) owns private input and handback.

The [script execution contract](computer-use-scripts.md) owns full/diff output
and interpreter lifetime. Every local read receives a full normalized tree.
The first emitted tree is full; later emissions can diff only the same document
and scope with complete bounded trees. Parent, child, relation, focus and state
changes participate in the diff. Navigation, truncation, failure, takeover or a
changed scope resets the baseline. Confirmed actions survive an observation
failure; failed content never enters model history and input is not replayed.

# Evidence

- `redeven:internal/ai/computer_semantic.go` - Runtime schema validation, role inventory, byte pruning and focus projection.
- `redeven:internal/ai/computer_semantic_test.go` - graph, relationship, state, diff, selector and privacy assertions.
- `redeven:internal/envapp/ui_src/scripts/computerBrowserPage.mjs` - Chromium native collection and frame references.
- `redeven:desktop/native/computer-host/Sources/RedevenComputerHost/Accessibility.swift` - AX collection and secure-value boundary.
- `redeven:internal/ai/computer_atspi_linux.go` - private AT-SPI states, relationships and revision revalidation.
