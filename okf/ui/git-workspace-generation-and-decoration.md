---
type: UI Contract
title: Git workspace generations, diffs and visual state
tags: [ui, git, files, state, interaction]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Exact client capabilities and monotonic generations fence Git inventory/diffs/filesystem decoration. Retain shell/navigation with panel-local loading/errors; Files navigation never waits for Git. Nested file references and effects use JSON-only transport.

# Contract

## Generations and effects
Use workspace-v1 only after exact client confirms revision/path-status/directory-scope/stash-section capabilities. Replacement retires old generations/replies. Files avoids unbounded legacy reads; Files→Workspace starts fresh generation before section/scope. Committed repository/path identity fences facts; bound replacements while retaining committed decoration. Distinguish index/worktree/untracked/conflict/stash identities.

One `GitWorkspaceInvalidationBus` invalidates every dispatched effect in finally, including failures/unknown transport; validation/preview never invalidate. Encoders omit absent optional fields before Flowersec JSON-only APIs, preserving false/empty strings/literal paths; later JSON serialization does not excuse undefined fields. Do not relax upstream validation.

Actions retain directory and section scope. Totals cover descendant files; browsing omits repetitive folder counts. Commit review always loads staged root because commit affects whole index; incomplete line counts are not zero. Deletion previews every consequence, including branch-only entry. Any worktree blocker disables safe/force confirmation before merged-state checks. Localize primary/locked/nested blockers; retain removal/discard authorizations, including ignored-only files.

Public codes produce localized permission/stale/resource/rejection/unknown guidance without private diagnostics. Unknown outcomes require refresh/review, no automatic replay. Keep legacy code 41304 reserved/localized: retired full-tree deletion-inspection limit differs from transient pressure and waiting alone does not fix oversized trees.

## Diffs and persistence
Inline/Activity/Workbench/dialog share one diff owner. Snapshot patches are previews; refresh/authoritative empty/failure cannot revive them. Runtime owns first-parent meaning. Workbench persists placement targets, not summaries; equal target fields preserve requests/full context/expansion/scroll through unrelated updates. Workspace refresh retains same-request patch/full-context paint until authoritative success/empty/error; client changes never retain it. Other inspections retain fresh-summary semantics. Disconnect is not missing file; confirmed absence settles empty, errors retain recovery.

## Tree workspace
Files/Git switch keeps one native button pair; Solid Portal moves it between matching top-row slots and restores trigger focus. Forward slot callbacks through wrappers and resolve JSX once before testing/rendering; detached duplicate slots cannot own controls. Narrow Files keeps it above directory drawer. Repository/sync shares top row; full-width Git navigation spans both panes, never separate sidebar/drawer. Divider resizes rail and matching mode slot. One published Floe Tabs owns all four items, keyboard navigation and sliding indicator; immediate activation delegates timing to the host. Embedded stash content has 12px toolbar separation. Branch/history selectors follow navigation; narrow detail uses retained list/detail/back. Pending navigation hides stale content until destination commit; stash dismissal joins that commit, including same-view returns. Narrow navigation scrolls without overlap.

Changes defaults All over bounded Changes/Staged/Conflicted pages. Filters preserve scope; same-path index/worktree selection stays exact. Initial All reads serialize through existing owner; refresh revalidates nonempty or invalidated sections, mutations join the invalidation refresh owner, client/repository replacement cancels remainder. Errors offer retry. Rail owns search/collapsed trees/scope actions/commit draft; draft never bypasses whole-index review.

Stashes opens within full-width workspace navigation using existing owner/review/draft; contextual stash inspection may float. Unified/side-by-side and patch/full-context are independent retained choices. Replacement pairing preserves blank sides/line numbers/context without changing authoritative reads.

Workspace/worktree/history/comparison/stash share tree adapter. Folders start collapsed. Collapse-all uses inward-chevron, is enabled only for expanded folders and clears forced-expansion filtering. Mouse rows 24px, indent 12px, headings 28px; coarse controls >=44px. Exact paths/rename targets/section/stash identities own actions; expansion never retargets. Arrows move/expand/collapse, Enter/Space opens; keyboard/menu handoff captures target. Modified/added/deleted/renamed status inks remain separate from selection.

Expansion reads bounded pages without replacing root/scope or inserting skeleton rows. Busy state remains accessible; errors retain retry. Client/repository/worktree/generation/section/path/revision fence replies. Refresh retires read authority while retaining painted nodes by section/path and revalidates expanded pages at offset zero. Section generations avoid unrelated reloads; repository/client changes clear retained state. Never append stale offsets. Stale revisions refresh without replay; failed pages retry the same offset. Search matches loaded paths, leaving unread folders navigable; no silent full scan.

Native constrained tree viewport owns both scroll axes, allowing natural indentation/full names. Floe persistent horizontal scrollbar stays reachable; tabs/filter/draft/diff do not scroll with tree. Mode/narrow navigation retains tree DOM/scroll. Draft heading shows staged count and optional whole-index line totals; unavailable totals remain absent. Commit always opens whole-index confirmation.

## Presentation
Navigation/branches/history/summaries/files use ring-derived interaction roles independent of text selection or semantic status. Neutral hover never masks selection. One measured owner fits graph rails/connectors/nodes/columns without moving summaries or changing selection/actions. Shared retained file/diff navigation retires stale targets after filter/remove/section/commit changes. Branch refresh is not append loading; pagination uses one retained control without decorative skeletons. Narrow/workbench scrolling stays contained.

All themes define full interaction roles; forced colors expose focus/selection/Current boundaries. Select whole rows with no colored left rail; keyboard/system-color states use inset outline. Files/Git disabled reason appears below tabs through Floe floating layer, unobscured from first animation frame in normal/projected hosts; wrap within viewport and dismiss on exit.

Avoid decorative rails/empty subtitles. Branches expose selected state; shared typography/dialog/button/input/textarea own sizing/material/focus/presence. Dialog has one footer divider/padding; window-local stash supplies equivalent. Narrow bodies scroll with actions reachable. Nested desktop diff modes stay 28px; toolbars wrap complete controls and coarse targets remain 44px. Restrained warning/danger tint meets 4.5:1 in every built-in theme. Deletion has one consequence summary/localized safe-delete guidance, technical diagnostics disclosed. Exact-name confirmation has one field/copy action. Keep confirm button identity; pending deletion retains reviewed fields/consequences while disabling edits/dismissal. Reduced motion removes row travel, preserves shared modal rules.

# Boundaries

Revision is read consistency, never mutation authority. UI cancel cannot prove no effect; unknown still invalidates. Non-Git Flowersec allocation is outside this budget. Layout persistence proves no freshness and cannot change inline/Activity/Stash semantics. Themes may vary hue, never substitute status colors/fixed foreign palette or Current for selection.

# Evidence

Under `internal/envapp/ui_src/src/ui/widgets`: `GitWorkspaceTree`, `gitWorkspaceTreeModel` tests cover retained node identity, bounded lazy reads/fences/keyboard; `GitWorkspaceRedesign` and `FileBrowserWorkspace.navigation` browser tests cover retained rails/drafts/scroll/themes/widths, unified tab motion/keyboard/reduced motion and stash spacing. `GitDiffPanel`, `RemoteFileBrowser`, `GitChangesPanel`, `GitDeleteBranchConfirmDialog` cover diffs/scoped review. `../protocol/redeven_v1/gitRequests.test.ts` covers all 31 RPC methods. `GitDialogVisual` checks 28-theme contrast, footer/geometry/identity/focus/locales/reduced motion; `GitHistoryModeSwitch` checks first-frame tooltip clearance. `src/styles/gitBrowserSelectionVisual.browser.test.tsx` checks 28 themes and both materials. RemoteFileBrowser.paths.browser.test.tsx covers cold entry and visible native-control identity through real Activity/Workbench wrappers. Protocol IDs: `src/ui/protocol/redeven_v1/typeIds.ts`.

Built checkGitInteractionElectron.mjs qualifies stage/unstage frame continuity, staged totals, collapse/scroll, branch-diff geometry, navigation frames and 12px stash-card separation under supervised cleanup.
