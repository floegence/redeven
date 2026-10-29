---
type: Protocol Contract
title: Computer semantic snapshots
tags: [ai, computer-use, accessibility, protocol]
lifecycle: contract
reviewed_at: "2026-10-28"
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

Single-node reads use the same bounded observation path on browser, macOS and
Linux. child_refs only links returned nodes; an omitted child is not an empty
subtree. Native child-list read failures stop observation rather than becoming
empty arrays.

Name, description and string value have a 2,000 Unicode code-point budget.
name_truncated, description_truncated and value_truncated are true only when
the adapter omitted part of that field; snapshot truncated continues to describe
omitted nodes. Runtime validates these flags and preserves them in compact,
detailed, diff and single-node output. A detailed read does not remove field limits.
Browser query items also carry name_truncated when needed.

References compare the full native name through a bounded SHA-256 digest, never
the displayed prefix. Changed names receive different tokens so a fresh observation
cannot rebind an old reference. Browser collection cursors include complete-name digests
for every match, including items outside the current page. The existing reference
table and cursor owner remain authoritative; no additional lifecycle or replay
state exists. A failed or malformed DOM/AX identity read is observation-unavailable,
not proof of a stale reference. Preserve the observed token and sanitized protocol
method/code, reject input before dispatch, and require successful validation on a
later explicit call. Only confirmed identity changes invalidate the token. Semantic selectors match full names, including on native adapters.

Both directions of every parent/child edge must agree. An observation describes the bounded returned tree, not an exhaustive view of every application node.

## Roles, states and relationships
One Runtime alias inventory owns normalization and canonical selector expansion.
Standard landmarks including navigation, main, banner, contentinfo and
complementary, plus supported structural/live-region roles, round-trip through
this inventory. Unknown `other` remains reference-only, never a wildcard. Invalid
canonical selectors return safe field/expected/recovery diagnostics before dispatch.
Browser references are opaque bounded hashes of controller, document revision,
frame, native node identity, role and complete-name digest. The existing reference table remains their sole
owner; no second alias registry exists.

An ignored or truncated target has no invented reference; a platform-computed name or safe description may still be available.

# Boundaries

## Privacy and output lifecycle
Adapters retain the existing sensitive-field, CAPTCHA, origin/application and revision checks before exposing content. Runtime additionally rejects secure AX subroles and password-text nodes, constrains types and sizes, and strips unknown metadata.

Confirmed actions survive an observation failure; failed content never enters model history and input is not replayed.

# Evidence

- `redeven:internal/ai/computer_semantic.go` - Runtime schema validation, role inventory, byte pruning and focus projection.

- `redeven:internal/ai/computer_semantic_test.go` - graph, relationship, state, diff, selector and privacy assertions.
- `redeven:internal/ai/computer_field_integrity_test.go` - normalization, compact/detailed/diff/guest preservation, scalar bounds and diagnostics.
- `redeven:internal/envapp/ui_src/scripts/computerFieldIntegrity.node-test.mjs` - real Chromium Unicode boundaries and full-name reference/cursor checks.

Browser identity-read failures and explicit recovery also have real Chromium and
connected-extension regressions in computerScrollReference.node-test.mjs and
computerExtension.node-test.mjs.
