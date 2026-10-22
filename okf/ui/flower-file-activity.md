---
type: UI Contract
title: Flower file activity presentation
description: Typed file mutation statistics, diff disclosure, and action ownership.
tags: [ai, flower, files, activity, presentation]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
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

Published Floret v7.30.0 owns the product-neutral file Activity payload. A read carries bounded content and line metadata.

[Preview recovery](file-preview-window-actions.md) keeps unavailable targets actionable without changing historical content.

# Boundaries

Activity presentation is not a filesystem authority or a second mutation record. The canonical tool result and Floret Activity lifecycle remain the owners of execution and persistence. Display names are not paths, line counts cannot prove current workspace state, and the UI never fetches a file or recomputes a diff merely to populate a historical row.

# Evidence

- `redeven:internal/ai/floret_tools.go` - One result-to-Floret payload mapping preserves reads and all ordered mutations.

- `redeven:internal/ai/activity_file_actions.go` - Public Activity sanitization permits only explicit target paths while filtering unrelated private fields.

- `redeven:internal/ai/activity_file_targets.go` - Maps confirmed targets and enriches response copies through exact canonical queries.
