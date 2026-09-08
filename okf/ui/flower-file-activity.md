---
type: UI Contract
title: Flower file activity presentation
description: Typed file mutation statistics, diff disclosure, and action ownership.
tags: [ai, flower, files, activity, presentation]
timestamp: 2026-08-28T00:00:00Z
---
# Summary

Flower presents file reads and mutations only from canonical typed Floret
Activity. A mutation row shows the user-facing file name and aggregate added and
deleted line counts; its detail contains the matching unified diff. Protocol
fields, private paths, and internal action IDs never become display metadata.
An activity without typed mutation detail exposes safe purpose and status through
the shared disclosure, without inventing a diff panel.

# Contract

Published Floret v7.1.4 owns the product-neutral file Activity payload. A read
carries bounded content and line metadata. A single-file mutation carries its
display name, change type, added and deleted line counts, unified diff,
unavailable reason, and truncation state. A patch carries aggregate counts and
an ordered typed mutation list. Redeven maps the tool result to that payload
once; Flower does not parse provider text, tool-result JSON, labels, or chips to
reconstruct file changes.

The compact row and expanded detail consume the same mutation collection.
Flower sums its `additions` and `deletions` for the compact green/red statistic
and renders each mutation's `unified_diff` in order when the user expands the
row. A typed unavailable reason may produce the localized generic empty-diff
message, and truncation uses localized copy. Missing typed mutation evidence
does not create statistics or diff content. [Activity disclosure interaction](flower-activity-interaction.md)
owns the stable detail affordance, safe empty state, and file-read error expansion.

File preview and directory actions are referenced through ordered
`target_refs` whose kinds contain opaque `file_action` identities. Redeven uses
transient result IDs only to build those references, then removes them and all
private paths from the public Activity payload. Flower associates references
with typed mutations by order and never reads an action ID from payload data.

# Boundaries

Activity presentation is not a filesystem authority or a second mutation
record. The canonical tool result and Floret Activity lifecycle remain the
owners of execution and persistence. Display names are not paths, line counts
cannot prove current workspace state, and the UI never fetches a file or
recomputes a diff merely to populate a historical row.

# Evidence

- `redeven:internal/ai/floret_tools.go` - One result-to-Floret payload mapping preserves reads and all ordered mutations.
- `redeven:internal/ai/activity_file_actions.go` - Public Activity sanitization removes private paths and transient action IDs.
- `redeven:internal/ai/activity_timeline_test.go` - Read, mutation, patch, target-reference, and chip coverage.
- `redeven:internal/flower_ui/src/flowerActivityPresentation.ts` - One presenter derives compact statistics, actions, and diff detail.
- `redeven:internal/flower_ui/src/flowerActivityPresentation.test.ts` - Typed mutation content and absent-diff payloads are covered.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Localized compact statistics and unified-diff detail rendering.
