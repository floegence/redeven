---
type: UI Contract
title: Flower file activity presentation
tags: [ai, flower, files, activity, presentation]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Canonical typed Floret Activity owns confirmed reads/mutations; output-progress owns provisional argument counts. Rows show user filename and added/deleted totals with matching unified diff. Protocol fields/private paths never become display metadata. Historical targets grant no read authority. Missing typed detail shows purpose/status without inventing a diff.

# Contract

[Task files](../ai/flower-task-files.md) add explicit verified delivery results and a
shared Files panel. The structured result links to the confirmed user destination;
intermediates remain in a separate expandable working-file section.

Published Floret v7.30.0 owns the product-neutral file Activity payload. A read carries bounded content and line metadata.

[Preview recovery](file-preview-window-actions.md) keeps unavailable targets actionable without changing historical content.

# Boundaries

Activity presentation is not a filesystem authority or a second mutation record. The canonical tool result and Floret Activity lifecycle remain the owners of execution and persistence. Display names are not paths, line counts cannot prove current workspace state, and the UI never fetches a file or recomputes a diff merely to populate a historical row.

# Evidence

- `redeven:internal/ai/floret_tools.go` - One Floret result mapping for reads and ordered writes.

- `redeven:internal/ai/activity_file_actions.go` - Explicit Activity targets with unrelated private fields filtered.

- `redeven:internal/ai/activity_file_targets.go` - Confirmed target enrichment through canonical queries.
