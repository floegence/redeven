---
type: UI Contract
title: Git workspace generations, diffs and visual state
tags: [ui, git, files, state, interaction]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Exact client capabilities and monotonic generations fence Git inventory, diffs and filesystem decoration. Keep Git shell/navigation mounted with local panel loading/errors, no second curtain. Diff requests/nested file references obey JSON-only transport. Filesystem navigation never waits for Git.

# Contract

## Workspace generations
Use workspace-v1 only after the exact client confirms revision/path-status/directory-scope/stash-section capabilities. Client replacement retires old capabilities/generations and late replies. Files never uses unbounded legacy reads; Files→Workspace opens a fresh generation before section/scope.

One monotonic protocol `GitWorkspaceInvalidationBus` invalidates every dispatched effect in `finally`: success, application failure or unknown transport outcome; preview/validation cannot invalidate.

Committed path/repository identity fences detection; old directories cannot leak facts. Bound replacement generations while preserving committed decoration. Section identity distinguishes staged/unstaged/untracked/conflicted and stash rows.

## Git action requests and review
Every Git encoder omits absent optional fields before calling the published JSON-only Flowersec API. Preserve explicit `false`, empty strings and literal file paths; serializing an object with `undefined` later is not a valid boundary. Redeven owns this adapter; do not relax upstream validation.

Directory navigation and bulk actions retain changes/staged/conflicted section identity. Section totals describe descendant files in the current scope; browsing rows omit repetitive folder counts. Opening commit review loads the staged root because committing covers the whole index; directory summaries show folder counts, and incomplete line totals are not presented as zero.

Deletion uses the authoritative preview for every consequence, even when entered through a branch-only action. Any worktree blocker disables both safe and force confirmation before merged status is considered. Primary, locked and nested-worktree blockers are localized from structured codes. Show the reviewed removal/discard effects and carry both authorizations; an ignored-only worktree still requires discard review.

Stable public error codes produce localized permission, stale-state, resource, request-rejection or unknown-outcome guidance without private Git/transport diagnostics. Unknown outcomes require refresh and review; never automatically replay a mutation. Keep deletion-inspection limit code 41304 reserved and localized for compatibility with older runtimes; current risk-based deletion reviews do not perform the retired full-tree scan. Legacy guidance distinguishes this failure from transient resource pressure and never implies that waiting alone resolves an oversized tree.

## Diff requests
Inline/Activity/Workbench/dialog share one owner. Caller patch snapshots are previews; refresh or authoritative empty/failure cannot revive them. Runtime owns first-parent meaning.

Persisted Workbench widgets store placement targets, never Git summaries. Equal target fields preserve in-flight work, patches/full context, expansion and both scroll axes across unrelated snapshots. Other inspections retain same-path fresh-summary behavior. Connection absence is not missing-file failure; successful no-file settles empty without old patches/perpetual overlay, failures retain recovery.

## Visual state
Navigation/branches/history/summaries/files use `ring`-derived interaction tokens independent of text selection. Neutral hover cannot override selection; success/warning/danger/info/remote-violet describe facts, never selection/focus.

One measured owner lays out graph rails/connectors/nodes/columns within available width without moving summaries or changing actions/selection. Workspace/commit/branch status/history/comparison reuse retained file/diff navigation; filtering/removal/section/commit changes retire stale selections. Narrow/Workbench views remain contained with independent scrolling.

Every preset has complete interaction roles. Forced colors expose selection/focus/Current-chip boundaries through system colors. Selected navigation, branches, stashes and file rows use a complete surface without a colored left stripe; keyboard focus and forced-color selection retain an inset whole-row outline.

The Files/Git switch places its disabled-reason tooltip below the tabs through the published Floe floating layer. Keep both buttons unobscured from the first visible animation frame in viewport and projected-surface hosts, contain wrapped text, and dismiss on pointer exit.

## Tree review workspace
The shared Files/Git control has one mounted native button pair across retained mode panels. Solid Portal moves it between matching top-row slots. Forward each slot callback through workspace wrappers and resolve slot JSX once before testing presence or rendering; detached duplicate slots cannot own the control. Keyboard focus returns to the triggering button. Narrow Files layouts keep this control above the directory drawer. Repository identity and sync actions share the top row. Git navigation spans the complete workspace above both review panes; it never belongs to a separate sidebar or drawer. The review divider resizes the file rail and matching mode slot together. Branch/history selectors stay below the navigation. Pending navigation hides stale panels until the destination commits; stash dismissal shares that commit, including same-view returns. Narrow navigation scrolls without overlapping actions. Narrow file inspection uses retained list/detail steps with a back action.

Changes defaults to All, grouping the existing bounded Changes/Staged/Conflicted pages. Section filters retain their authoritative scopes; selecting a file preserves its exact section even when a path appears in both index and worktree. Initial All reads serialize through the existing owner; refresh revalidates nonempty sections, mutations refresh affected sections, and repository/client changes cancel the remaining read sequence. Section errors expose explicit retry. The file rail owns search, collapsed trees, scope actions and a retained commit draft. Whole-index review remains mandatory before commit.

Stashes opens inside the workspace from the full-width navigation, reusing the existing stash owner, draft and review contracts. Other contextual stash requests retain their floating inspection. Unified/side-by-side presentation and patch/full-context selection are independent retained preferences. Side-by-side pairs replacement runs and preserves blank sides, line numbers and context without changing authoritative diff requests.

Workspace, branch worktree, history, comparison and stash inventories share the Git tree adapter. Directories start collapsed. Collapse-all uses an explicit inward-chevron action, enabled only with expanded folders; it also clears filtering that forces expansion. Mouse layouts use 24px tree rows, 12px indentation and 28px group headings; coarse input keeps 44px controls. Exact paths, rename targets and section/stash identities remain authoritative; expansion never changes action targets. Arrow keys move focus/expand/collapse, Enter/Space opens the file, and keyboard/context-menu handoffs keep their captured target. Modified/added/deleted/renamed paths use warning/success/error/info ink independently of selection.

Folder expansion reads one bounded directory page from its existing RPC owner. It never replaces the root inventory or its scope. Client, repository/worktree, generation, requested section/path and workspace revision fence replies. Refresh, mutations and root replacement retire child caches; stale revisions refresh authoritative inventory without replaying effects. Failed child pages offer retry at the same offset. Filtering matches loaded paths and leaves unread folders navigable; it does not silently scan a repository.

The Files and Git trees own both scroll axes. Natural indentation and full names may overflow only their constrained native viewport; the published Floe persistent horizontal scrollbar stays reachable below it. Tabs, filter, commit draft and diff do not move with tree scroll. Switching Git views and narrow list/detail steps preserves tree DOM and scroll state. The draft heading shows staged file count and optional whole-index line totals from the repository summary; unavailable totals stay absent. The explicit Commit action still opens whole-index review; drafting never bypasses that confirmation.

## Review presentation
Git groups avoid decorative side rails or empty-status subtitles. Branch rows expose their selected state; text follows published body/caption roles. Dialog, Button, Input and Textarea retain Floe material, sizing, placement and presence. A Dialog owns its only footer separator/padding; window-local stash review supplies one equivalent footer. Narrow reviews scroll their body while actions stay reachable. Nested desktop diff modes remain 28px controls; toolbars wrap whole controls, with 44px targets reserved for coarse input.

Warning/danger notices use restrained semantic tint with readable theme ink, never solid-fill foreground tokens on a pale background. All built-in themes meet 4.5:1 notice-text contrast. Deletion shows one consequence summary; safe-delete guidance is localized, with raw diagnostics behind explicit technical details. Exact-name confirmation uses one labeled field and one copy action. Validation keeps the same confirm button mounted, and deletion retains its reviewed consequences/field while disabling editing and dismissal until the effect settles. Reduced motion removes Git row travel/transitions and preserves shared modal presence rules.

# Boundaries

Revisions grant read consistency, never mutation authority. UI cancellation cannot prove an effect did not run; unknown outcomes still invalidate. Non-Git Flowersec outbound allocation remains outside this transport budget and cannot be claimed fixed by batching.

Layout persistence proves no content freshness. Workbench target stability cannot change inline/Activity/Stash fresh-summary semantics. Themes may vary selection hue/surfaces, never replace interaction roles with Git status colors, inherit another theme's fixed palette or use Current as selection.

# Evidence

- `redeven:internal/envapp/ui_src/scripts/checkGitInteractionElectron.mjs` — supervised built-renderer acceptance for staged totals, collapse/scroll, branch commit diff geometry and navigation frames; cleanup is part of success.

- `redeven:internal/envapp/ui_src/src/ui/widgets/GitWorkspaceTree.test.tsx`, `gitWorkspaceTreeModel.test.ts` — lazy pagination, stale replies, exact paths and keyboard navigation.
- `redeven:internal/envapp/ui_src/src/ui/widgets/GitWorkspaceRedesign.browser.test.tsx`, `FileBrowserWorkspace.navigation.browser.test.tsx` — retained rail/draft, independent horizontal scrolling, light/dark themes and adaptive widths. `RemoteFileBrowser.paths.browser.test.tsx` exercises cold Files/Git entry and visible native control identity through real Activity/Workbench workspace wrappers.

- `redeven:internal/envapp/ui_src/src/ui/protocol/redeven_v1/typeIds.ts` - Source.

- `redeven:internal/envapp/ui_src/src/ui/widgets/GitDiffPanel.test.tsx` - Diff tests.
- `redeven:internal/envapp/ui_src/src/ui/protocol/redeven_v1/gitRequests.test.ts` - All 31 Git methods at the public RPC adapter boundary.
- `redeven:internal/envapp/ui_src/src/ui/widgets/RemoteFileBrowser.e2e.test.tsx`, `GitChangesPanel.e2e.test.tsx`, `GitDeleteBranchConfirmDialog.test.tsx` - Scoped interactions and reviewed deletion consequences.
- `redeven:internal/envapp/ui_src/src/styles/gitBrowserSelectionVisual.browser.test.tsx` - Chromium selection across 28 themes and standard/soft material, with real branch sidebar widths.

- `redeven:internal/envapp/ui_src/src/ui/widgets/GitDialogVisual.browser.test.tsx` - Real dialogs, 28-theme notice contrast, single footer, narrow scrolling, exact confirmation/button identity, pending geometry, keyboard return, localization and reduced motion.

- `redeven:internal/envapp/ui_src/src/ui/widgets/GitHistoryModeSwitch.browser.test.tsx` - First-frame clearance, narrow viewport wrapping, projected-surface placement and pointer dismissal.
