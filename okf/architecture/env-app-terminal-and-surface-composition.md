---
type: Frontend Contract
title: Env App terminal and surface composition
tags: [architecture, env-app, terminal, ui]
quality_exception: Cross-surface composition, placement, loading and renderer boundaries.
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Env App adapts Floeterm PTY facts and Floe shell/focus/selection/KeepAlive. Redeven owns product views and localized controls. Runtime nodes stay keyed by session ID across views. Visible panes paint independently; active session owns input/search/commands.

# Contract

File preview defaults to the main surface. Chunked history remains one atomic snapshot with canonical dimensions. Compound controls use Floe CSS.

## Terminal workspace placement

Published SplitWorkspace owns splits, presets, docking, swaps and accessible resizing. Splitting creates a backend view; later placement edits update it. Users manage independent named views through thumbnails, rename/delete and creation above Directories.

Each session has at most one owning view. Selecting a member activates its owner and focuses the pane, including from another view or standalone session. Unowned sessions display alone. Cross-view dragging moves membership atomically and leaves the source slot vacant. Pane and sidebar close buttons terminate the named session; they never delete a view or collapse its geometry. Only the view action deletes a view, releasing its sessions without closing them. New views create fresh sessions. Layout selection only rearranges the current saved view: it preserves all members (including temporarily unavailable sessions), visual reading order and focus. Only published presets matching its slot count are offered; standalone, single-pane and larger custom views disable that menu. Adding sessions requires explicit splitting, dragging or creation in a vacant slot. Explicit splitting uses the target group and verified local cwd or group startup directory. Group membership and cwd remain independent.

Desktop starts at pane headers, with preference-controlled Workbench activity indicators. Its footer retains presets, search, clear, settings and creation. Groups retain scoped creation; overlays keep toolbar/drawer controls.

Split creation/attachment never covers existing panes with global loading. Environment/view changes fence async placement. Mobile shows active-pane tabs without rewriting desktop trees. There is no pane-maximize mode; Alt+Shift+Left/Right cycles panes.

Pane chrome follows terminal foreground/background, never ANSI blue; sidebar follows shell tokens. Compact 14px session tiles use fine contrasting borders and subtle theme-neutral fills; pane headers are 28px high. Rename opens with the existing name focused and selected through Floe overlay autofocus. Idle hover uses pointer; only active drags show grabbing. Sidebar close appears on hover/focus and stays available on touch. Placement previews use terminal foreground borders with background isolation and a contrasting fill. Shared geometry notices are absent.

## View projection

One environment provider batches affected source/destination views in revision-checked atomic saves. Edits survive acknowledgment; conflicts retain drafts for explicit reload/discard. Catalog loading waits for shell-confirmed access on the current transport. Reconnecting pauses requests without discarding view drafts, and restored access loads automatically. One lifecycle resets environment/permission authority before loading; unchanged permissions preserve readiness/drafts, and retired connections cannot publish. Layout edits wait for readiness.

Active view stays local per panel. Legacy v1 local splits import unowned members once and clear after backend acknowledgment. Missing sessions render as vacant slots without pruning saved geometry. Closure persists fresh vacant identities; even an entirely vacant view remains selected. Each vacancy offers localized session creation and accepts a dragged session into that exact slot. Moving within a view leaves the source vacant. Slot creation shows local progress and recoverable errors; failed close restores the session. Empty-view selection never falls back to an unrelated session. Views do not restart PTYs.

# Boundaries

Redeven supplies placement, permissions, local-path capability and localized chrome. It must not parse output, predict echo, own history/renderer state, recreate shell token/layer/focus machinery, or overlay a retained surface with duplicate recovery. Browser/semantic carriers verify this boundary; packaged Desktop qualification is separate.

# Evidence

- redeven:internal/envapp/ui_src/src/ui/widgets/terminalWorkspace.ts - Placement/selection adapter.
- redeven:internal/envapp/ui_src/src/ui/services/terminalViewCatalog.ts - Revisioned projection.
- redeven:internal/envapp/ui_src/scripts/checkTerminalWorkspace.mjs - Real PTYs, retained nodes, cross-browser views, mobile and reload.
