---
type: UI Contract
title: Git diff request lifecycle
tags: [ui, git, diff, workbench, lifecycle]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

One Git panel binds preview/full reads to target/revision/transport/mode. Stale replies cannot replace current content; unchanged placement retains request/content/scroll/expansion. Missing transport waits for Shell, while empty/error states settle explicitly without automatic retry.

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

- redeven:internal/envapp/ui_src/src/ui/widgets/GitDiffPanel.test.tsx

- redeven:internal/envapp/ui_src/src/ui/workbench/WorkbenchGitDiffWidget.tsx
