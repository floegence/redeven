---
type: Frontend Contract
title: Env App terminal and surface composition
tags: [architecture, env-app, terminal, ui]
quality_exception: Cross-surface composition, placement, loading and renderer boundaries.
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Env App adapts Floeterm PTY facts and Floe shell/focus/selection/KeepAlive. Redeven owns product views and localized controls. Runtime nodes stay keyed by session ID across view/layout changes. Visible panes paint independently; active session owns input/search/commands.

# Contract

File preview defaults to the main surface. Chunked history remains one atomic snapshot with canonical dimensions. Compound controls use Floe CSS.

## Terminal workspace placement

Published SplitWorkspace owns splits, presets, docking, swaps and accessible resizing. Splitting creates a backend view; later placement edits update it. Users manage independent named views through thumbnails, rename/delete and creation above Directories.

Selecting a member focuses it and restores maximized panes. Selecting an outside session shows it alone and deselects the view; only explicit view selection restores saved splits. Closing panes/deleting views preserves sessions. Explicit splitting creates a session in the target group at its verified local cwd or group startup directory; dragging places an existing session. Placement, membership and cwd remain independent.

Desktop starts at pane headers, with preference-controlled Workbench activity indicators. Its footer retains presets, search, clear, settings and creation. Groups retain scoped creation; overlays keep toolbar/drawer controls. Maximize changes to restore.

Split creation/attachment never covers existing panes with global loading. Environment/view changes fence async placement. Mobile shows active-pane tabs without rewriting desktop trees. Maximize is transient; Alt+Shift+Left/Right cycles panes.

Pane chrome follows terminal foreground/background, never ANSI blue; sidebar follows shell tokens. Rounded session tiles use contrasting border/fill mixes. Idle hover uses pointer; only active drags show grabbing.

## View projection

One environment-scoped provider serializes debounced saves with captured per-view base revisions. In-flight edits survive acknowledgment. Conflicts retain drafts with explicit reload/discard, never blind retries. Reconnect recovers loading; permission loss clears metadata. Layout edits wait for catalog readiness.

Active view stays local per panel. Legacy v1 local splits import once and clear after backend acknowledgment. Missing sessions disappear from rendering, never stored layouts; empty views offer session creation. Views do not restart PTYs.

# Boundaries

Redeven supplies placement, permissions, local-path capability and localized chrome. It must not parse output, predict echo, own history/renderer state, recreate shell token/layer/focus machinery, or overlay a retained surface with duplicate recovery. Browser/semantic carriers verify this boundary; packaged Desktop qualification is separate.

# Evidence

- redeven:internal/envapp/ui_src/src/ui/widgets/terminalWorkspace.ts - Placement/selection adapter.
- redeven:internal/envapp/ui_src/src/ui/services/terminalViewCatalog.ts - Revisioned projection.
- redeven:internal/envapp/ui_src/scripts/checkTerminalWorkspace.mjs - Real PTYs, retained nodes, cross-browser views, mobile and reload.
