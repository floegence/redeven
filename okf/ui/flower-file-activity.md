---
type: UI Contract
title: Flower file activity presentation
description: Typed file mutation statistics, diff disclosure, and action ownership.
tags: [ai, flower, files, activity, presentation]
timestamp: 2026-10-08T00:00:00Z
---
# Summary

Flower presents confirmed file reads and mutations from canonical typed Floret
Activity. [Received output progress](flower-output-progress.md) owns temporary
argument-generation counts before those outcomes exist. A mutation row shows the user-facing file name and aggregate added and
deleted line counts; its detail contains the matching unified diff. Protocol
fields, unrelated private paths never become display metadata. Explicit navigation targets
are historical facts, not current read authority.
An activity without typed mutation detail exposes safe purpose and status through
the shared disclosure, without inventing a diff panel.

# Contract

Published Floret v7.30.0 owns the product-neutral file Activity payload. A read
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

File navigation uses explicit confirmed ActivityTargetRef paths from published
Floret v7.41.0. Single-file operations use Activity targets; each read_files
row and patch mutation owns its optional target. Reads, writes, edits, and
noops point to the confirmed file; moves point to the destination; deletions
point only to the parent directory. Failed, cancelled, rejected, unconfirmed,
and remote operations never gain local success navigation. Local image results
carry their known path separately from their retained image snapshot.

Redeven enriches authorized thread details and returned history pages through
published ThreadQueryReader.Query/Read, matching exact thread, turn, run, and
tool-call identity. One typed execution mapper serves new and historical results.
Batch hydration requires exact typed row/mutation evidence before copying targets;
matching names, labels, or ordinal references never establish a path. Missing
old evidence remains visible without navigation. Enrichment only changes response
copies, never canonical bytes, and performs no filesystem operations. Every query
and read rechecks the current user, endpoint, namespace, and exact thread scope.
Live updates retain already enriched targets in the existing bounded thread cache
only when execution identity and complete immutable Activity facts still match;
they do not repeat canonical history reads during streaming. There is
no action-ID resolver, sidecar, persistent mapping, or domain migration.

The compact row, detail toolbar, and batch entries use the same owned target.
Direct actions check current file readability before opening or focusing a preview.
A rejected or missing target produces one specific entry error and preserves the
current surface. Successful actions reuse and focus the preview or Files surface. Reading
checks current authorization and filesystem state. Document links retain their
preflight and cancellation boundary. [Preview recovery](file-preview-window-actions.md)
keeps unavailable targets actionable without changing historical content.

# Boundaries

Activity presentation is not a filesystem authority or a second mutation
record. The canonical tool result and Floret Activity lifecycle remain the
owners of execution and persistence. Display names are not paths, line counts
cannot prove current workspace state, and the UI never fetches a file or
recomputes a diff merely to populate a historical row.

# Evidence

- `redeven:internal/ai/floret_tools.go` - One result-to-Floret payload mapping preserves reads and all ordered mutations.
- `redeven:internal/ai/activity_file_actions.go` - Public Activity sanitization permits only explicit target paths while filtering unrelated private fields.
- `redeven:internal/ai/activity_file_targets.go` - Maps confirmed targets and enriches response copies through exact canonical queries.
- `redeven:internal/ai/activity_file_targets_persistence_test.go` - Checks compaction, fork, restart, immutable result bytes, and no tool replay.
- `redeven:internal/ai/activity_timeline_test.go` - Read, mutation, patch, target-reference, and chip coverage.
- `redeven:internal/flower_ui/src/runtimeCurrentView.test.ts` - Confirms exact immutable navigation retention across live updates.
- `redeven:internal/flower_ui/src/flowerActivityPresentation.ts` - One presenter derives compact statistics, actions, and diff detail.
- `redeven:internal/flower_ui/src/flowerActivityPresentation.test.ts` - Typed mutation content and absent-diff payloads are covered.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Localized compact statistics and unified-diff detail rendering.
