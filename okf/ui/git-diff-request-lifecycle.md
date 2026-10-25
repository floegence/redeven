---
type: UI Contract
title: Git diff request lifecycle
description: Preserve diff content across unrelated layout updates while keeping refresh, target changes, and transport recovery authoritative.
tags: [ui, git, diff, workbench, lifecycle]
timestamp: 2026-09-22T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

One shared Git panel owns preview/full-context reads by target, refresh revision, transport and mode. Stale responses cannot replace current content. Unchanged Workbench placement retains requests, content, expansion and scroll; target changes/refresh invalidate them. Missing transport waits for Shell recovery; empty/errors settle explicitly without automatic retries.

# Contract

## Request and refresh ownership
Inline, Activity, Workbench and dialog placements share the owner. Caller patch snapshots retain preview semantics, but explicit refresh and authoritative empty/failure never revive obsolete snapshots. First-parent meaning comes from runtime.

## Workbench placement continuity
Persisted widgets carry placement targets, not Git summaries. Equal target fields preserve in-flight work, patches/full context, expansion and both scroll axes across unrelated layout snapshots. Other inspection surfaces retain same-path fresh-summary behavior.

## Empty and failed results
Connection absence is not a missing-file error. Successful no-file results settle empty, without old patch or perpetual overlay; failures retain explicit recovery.

# Boundaries

Layout persistence does not report Git content freshness. Workbench may stabilize an unchanged placement target, but must not change the shared panel's fresh-summary semantics for inline, Activity, or Stash inspection. [Git browser visual states](git-browser-visual-states.md) owns file navigation, visual treatment, and scrolling geometry.

# Evidence

- redeven:internal/envapp/ui_src/src/ui/widgets/GitDiffPanel.test.tsx - Verifies deferred connection loading, transport replacement, late-result isolation, terminal errors, snapshot ownership, and same-path refresh.

- redeven:internal/envapp/ui_src/src/ui/workbench/WorkbenchGitDiffWidget.tsx - Distinguishes unchanged placement snapshots from changed Git targets before supplying the shared diff panel.

- redeven:internal/envapp/ui_src/src/ui/workbench/WorkbenchGitDiffWidget.browser.test.tsx - Verifies request, expansion, and scroll continuity across unrelated layout snapshots, target and explicit refresh invalidation, and transport recovery without moving the widget.
