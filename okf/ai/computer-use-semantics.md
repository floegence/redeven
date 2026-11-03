---
type: Protocol Contract
title: Computer semantic snapshots
tags: [ai, computer-use, accessibility, protocol]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

ComputerUseRuntime normalizes browser, macOS AX and Linux AT-SPI facts into bounded schema v2. Unsupported facts stay absent and relationships stay within the tree. Invalid observations are discarded while confirmed effects/output survive. Metadata grants no input authority and uncertain effects never replay.

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

Browser nodes report actions_scope:declared_only instead of guessing click/fill
support from roles or focusability. The listed actions are not an input allowlist;
target capabilities expose generic inputs and dispatch validates current
actionability. Native source-declared actions retain their platform meaning.

An ignored or truncated target has no invented reference; a platform-computed name or safe description may still be available.

## Reading order
Browser collection and Runtime normalization both preserve preorder depth-first root/sibling order, including guest/full/model output. Parents precede children, preserving valid bounded prefixes and omission flags. Structure never joins independently filtered fields into invented records; use source relationships and explicit object keys.

# Boundaries

## Privacy and output lifecycle
Adapters retain the existing sensitive-field, CAPTCHA, origin/application and revision checks before exposing content. Runtime additionally rejects secure AX subroles and password-text nodes, constrains types and sizes, and strips unknown metadata.

Confirmed actions survive an observation failure; failed content never enters model history and input is not replayed.

# Evidence

- `redeven:internal/ai/computer_semantic.go` - Source.
- `redeven:internal/ai/computer_semantic_test.go` - Tests.
- `redeven:internal/ai/computer_field_integrity_test.go` - Tests.
- `redeven:internal/envapp/ui_src/scripts/computerFieldIntegrity.node-test.mjs` - Tests.

Browser identity-read failures and explicit recovery also have real Chromium and
connected-extension regressions in computerScrollReference.node-test.mjs and
computerExtension.node-test.mjs.
