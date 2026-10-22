---
type: UI Contract
title: Git diff request lifecycle
description: Preserve diff content across unrelated layout updates while keeping refresh, target changes, and transport recovery authoritative.
tags: [ui, git, diff, workbench, lifecycle]
timestamp: 2026-09-22T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven's shared Git diff panel owns preview and full-context request lifetimes across all inspection placements. Responses belong to one target, refresh revision, transport, and content mode; obsolete results cannot replace current content. Workbench placement snapshots with unchanged target fields preserve pending requests, loaded content, expansion, and scrolling. Target changes and explicit refresh remain authoritative. Missing transport waits for shell recovery, while empty and failed results settle explicitly without automatic retry.

# Contract

## Request and refresh ownership
One shared diff panel owns preview and full-context requests for inline inspection, Activity windows, Workbench widgets, and the remaining dialog adapter.

Caller-supplied patch snapshots retain their independent preview semantics, but explicit refresh and authoritative empty or failed results never revive an obsolete snapshot. Commit first-parent presentation comes from the existing runtime contract.

## Workbench placement continuity
Workbench diff widgets receive persisted placement targets rather than Git content summaries. An unrelated layout snapshot, including opening another file preview, must retain pending requests, loaded patch and full-context content, expanded lines, and both scroll offsets when those fields are unchanged. This adapter boundary does not suppress same-path summary refreshes in other Git inspection surfaces.

## Empty and failed results
Waiting for a connection is not a missing-resource error. A successful result without a file settles as empty instead of leaving a loading overlay or old patch.

# Boundaries

Layout persistence does not report Git content freshness. Workbench may stabilize an unchanged placement target, but must not change the shared panel's fresh-summary semantics for inline, Activity, or Stash inspection. [Git browser visual states](git-browser-visual-states.md) owns file navigation, visual treatment, and scrolling geometry.

# Evidence

- redeven:internal/envapp/ui_src/src/ui/widgets/GitDiffPanel.test.tsx - Verifies deferred connection loading, transport replacement, late-result isolation, terminal errors, snapshot ownership, and same-path refresh.

- redeven:internal/envapp/ui_src/src/ui/workbench/WorkbenchGitDiffWidget.tsx - Distinguishes unchanged placement snapshots from changed Git targets before supplying the shared diff panel.

- redeven:internal/envapp/ui_src/src/ui/workbench/WorkbenchGitDiffWidget.browser.test.tsx - Verifies request, expansion, and scroll continuity across unrelated layout snapshots, target and explicit refresh invalidation, and transport recovery without moving the widget.
