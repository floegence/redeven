---
type: UI Contract
title: Git diff request lifecycle
description: Preserve diff content across unrelated layout updates while keeping refresh, target changes, and transport recovery authoritative.
tags: [ui, git, diff, workbench, lifecycle]
timestamp: 2026-09-22T00:00:00Z
---
# Summary

Redeven's shared Git diff panel owns preview and full-context request lifetimes across all inspection placements. Responses belong to one target, refresh revision, transport, and content mode; obsolete results cannot replace current content. Workbench placement snapshots with unchanged target fields preserve pending requests, loaded content, expansion, and scrolling. Target changes and explicit refresh remain authoritative. Missing transport waits for shell recovery, while empty and failed results settle explicitly without automatic retry.

# Contract

## Request and refresh ownership

One shared diff panel owns preview and full-context requests for inline inspection, Activity windows, Workbench widgets, and the remaining dialog adapter. A network request belongs to the exact published protocol RPC transport, selected target and refresh revision, and content mode. A mounted panel waits without sending RPC while transport is absent, then loads automatically when transport becomes available. Transport loss or replacement invalidates old network content and outstanding results. The next transport reloads preview and loads full context only when that mode is selected. Connection recovery and interaction suspension remain owned by the [shell lifecycle](workbench-surface-lifecycle.md); the panel has no independent reconnect controller, timer, or retry queue.

The selected Patch or Full Context mode is a panel browsing preference and remains active while the file selection changes. A changed source, file, or refreshed summary invalidates prior request ownership, including refresh at the same path; closing and disposal invalidate outstanding results. A mode switch retains an in-flight or completed request for the same owner. Caller-supplied patch snapshots retain their independent preview semantics, but explicit refresh and authoritative empty or failed results never revive an obsolete snapshot. Full context may show the current preview while loading. Binary, directory, unavailable, truncated, and failed diff states remain explicit. Commit first-parent presentation comes from the existing runtime contract.

## Workbench placement continuity

Workbench diff widgets receive persisted placement targets rather than Git content summaries. Their adapter compares repository root, workspace section, path, old path, new path, and change type by value. An unrelated layout snapshot, including opening another file preview, must retain pending requests, loaded patch and full-context content, expanded lines, and both scroll offsets when those fields are unchanged. Target changes, explicit refresh, widget body activation events, and transport replacement retain the shared panel's invalidation semantics. This adapter boundary does not suppress same-path summary refreshes in other Git inspection surfaces.

## Empty and failed results

Waiting for a connection is not a missing-resource error. Only an RPC 404 identifies an unavailable diff or source; RPC 403 identifies denied read access. Other failures use safe request-error copy without claiming that a file disappeared or that a decode error proves disconnection. Current-owner errors settle without automatic retry until refresh, a new selection revision, or a new transport. Caller-formatted Stash explanations remain safe, and raw Git output does not become UI copy. A successful result without a file settles as empty instead of leaving a loading overlay or old patch.

# Boundaries

Layout persistence does not report Git content freshness. Workbench may stabilize an unchanged placement target, but must not change the shared panel's fresh-summary semantics for inline, Activity, or Stash inspection. Connection recovery remains shell-owned; this request owner must not add polling or a second cache. [Git browser visual states](git-browser-visual-states.md) owns file navigation, visual treatment, and scrolling geometry.

# Evidence

- redeven:internal/envapp/ui_src/src/ui/widgets/GitDiffPanel.test.tsx - Verifies deferred connection loading, transport replacement, late-result isolation, terminal errors, snapshot ownership, and same-path refresh.
- redeven:internal/envapp/ui_src/src/ui/workbench/WorkbenchGitDiffWidget.tsx - Distinguishes unchanged placement snapshots from changed Git targets before supplying the shared diff panel.
- redeven:internal/envapp/ui_src/src/ui/workbench/WorkbenchGitDiffWidget.browser.test.tsx - Verifies request, expansion, and scroll continuity across unrelated layout snapshots, target and explicit refresh invalidation, and transport recovery without moving the widget.
- redeven:internal/envapp/ui_src/src/ui/widgets/GitDiffDialog.test.tsx - Verifies the selected context mode is reused for a newly selected file and requests the matching full-context payload.
