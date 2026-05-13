# Env App (env details UI over Flowersec E2EE)

This document describes the **Env App** implementation in the Redeven runtime.

Key points:

- The Env App UI is **runtime-bundled** (built + embedded into the Redeven runtime binary).
- The browser accesses it over a **Flowersec E2EE proxy** (runtime mode).
- Env details features live here: Activity, Deck, Workbench, Terminal, Monitor, File Browser, Git, Codespaces, Web Services, Flower, Codex, and Notes.
- Shared shell primitives come from released `@floegence/floe-webapp-*` packages. Redeven owns environment routing, permission gates, persistence wiring, local runtime APIs, and business widget bodies.
- Cross-surface right-click actions use Context Action Protocol v1. Surfaces provide structured context snapshots, while the shared action layer owns action identity and ordering for `Ask Flower`, `Ask Codex`, `Open in Terminal`, and `Browse Files`. See [`AGENT_SKILLS.md`](AGENT_SKILLS.md).
- Workbench has explicit ownership boundaries: shell chrome handles selection/drag, while widget bodies own text selection, local dialogs, context menus, and component focus. Wheel routing remains selected-widget guarded and scroll-viewport explicit.
- Runtime-shared Workbench state is limited to durable scene/widget facts. Per-client camera, selection, drafts, scroll position, and transient gesture state stay local.
- Redeven Desktop supplies session context, shell-owned theme/window chrome, titlebar-safe floating surfaces, and system-browser handoff for browser-app windows such as Codespaces.
- Runtime Settings uses an explicit information architecture so users can find endpoint controls by intent rather than by implementation detail:
  - `Overview`: `Config File`, `Connection`, `Runtime Status`
  - `Runtime Configuration`: `Shell & Workspace`, `Logging`
  - `Codespaces & Tooling`: `code-server Runtime`, `Codespaces Ports`
  - `Security`: `Permission Policy`
  - `AI & Extensions`: `Flower`, `Skills`, `Codex`
  - `Diagnostics`: `Debug Console`
- Runtime Settings -> `Overview` -> `Runtime Status` is the stable maintenance surface for Runtime Service ownership, compatibility, active work, and protocol. Optional update notices use toasts; risky restart/update actions always require confirmation.
- Web Services is the user-facing registry for HTTP services reachable from the runtime host. The persisted runtime entity remains `port_forward`, but the Env App treats each row as a service registration and chooses the open route from the current access context:
  - same-device local mode opens browser-safe loopback targets directly;
  - URL and SSH Local UI sessions open through the Local UI `/pf/<forward_id>/` proxy;
  - remote Provider / sandbox sessions keep using the isolated Flowersec E2EE port-forward tunnel.
- Codex is a separate optional AI runtime with its own activity-bar entry and gateway namespace. It is not a Flower mode/provider, and Runtime Settings reports Codex host status without persisting Codex approval, sandbox, model, or binary defaults.
- File Browser keeps Monaco as the single text preview/edit surface where possible, treats symbolic links explicitly, and enforces `fs/read_file` as file-only before raw bytes are streamed.
- Terminal sessions are runtime-owned and may be attached by multiple Env App surfaces; only the focused surface emits resize ownership updates after attach.
- Desktop-managed runs keep Preview, File Browser, Ask Flower, and Debug Console inside the main Env App window as product-owned floating surfaces. Browser-app windows such as Codespaces remain separate navigation flows.

## Notes overlay

Env App now exposes a product-owned **Notes overlay** that floats above the current workspace instead of introducing a new top-level activity page.

- Notes opens from the shell top bar and closes from a dedicated top-right close button inside the overlay.
- Notes also exposes a shell-level `Cmd/Ctrl+.` command so users can open or dismiss the overlay without leaving the current workspace flow, even while typing in another editor/input.
- Opening the overlay does not auto-focus an editor field; users can keep their current input focus until they explicitly create or edit a note.
- Env App enables the shared floe-webapp Notes surface in `interactionMode="floating"`, so the overlay stays non-modal over the current workspace instead of trapping focus like a settings dialog.
- On pages that keep the shell conversation sidebar visible, Notes still spans the full workspace viewport (`sidebar + main`) instead of shrinking to the main pane only.
- In floating mode, `Escape` dismisses the full overlay when focus is outside the Notes surface, and clicking outside the Notes-owned surface also dismisses the overlay without swallowing the underlying click target.
- A fresh Notes runtime boots with a default `Welcome` topic and one welcome note so first-time users land in a useful board instead of an empty shell.
- The overlay keeps a narrow topic rail with product-owned icons, inline rename/delete actions, and compact counts for live notes plus trash.
- Each topic renders on an infinite-style pan/zoom board:
  - wheel zooms around the cursor;
  - dragging the canvas or a note pans the board;
  - clicking a note without dragging copies the full note body and promotes that note to the top z-layer;
  - right-click (or long-press on touch) opens a Notes-specific context menu instead of the browser/system menu.
- Notes persist semantic style DSL fields (`style_version`, `color_token`, `size_bucket`) in the runtime so different Env App clients render the same card size/color footprint.
- Note preview size is derived from text length and capped to five stable size buckets; the card preview intentionally truncates large note bodies instead of expanding arbitrarily.
- Deleting a note moves it into a runtime-managed trash area with a fixed 72-hour retention window. Trash opens as a floating panel from the bottom-right dock icon, groups deleted notes by topic, preserves original color/size/coordinates for restore, supports per-topic clear, and also supports per-note `Delete now` for items already in trash.
- Notes state is runtime-authoritative: Env App fetches a snapshot from `/_redeven_proxy/api/notes/snapshot`, subscribes to ordered SSE updates from `/_redeven_proxy/api/notes/events`, and projects the same ordered topic/note/trash stream into every connected client.
- Workbench runtime state now follows the same runtime-authoritative pattern for cross-terminal consistency: Env App fetches `/_redeven_proxy/api/workbench/layout/snapshot`, subscribes to `/_redeven_proxy/api/workbench/layout/events`, persists shared layout replacements through `PUT /_redeven_proxy/api/workbench/layout`, opens preview widgets through the atomic `POST /_redeven_proxy/api/workbench/actions/open_preview` command, persists semantic widget state through `PUT /_redeven_proxy/api/workbench/widgets/:widget_id/state`, and drives shared terminal tab membership through `POST` / `DELETE /_redeven_proxy/api/workbench/widgets/:widget_id/terminal/sessions`, while the runtime stores the shared scene in `<state_dir>/apps/workbench/layout.sqlite`.
- Runtime trash deletion semantics stay explicit:
  - `DELETE /_redeven_proxy/api/notes/items/:note_id` moves an active note into trash and emits `item.deleted`.
  - `DELETE /_redeven_proxy/api/notes/trash/items/:note_id` permanently removes one trashed note and emits `item.removed`.
  - `DELETE /_redeven_proxy/api/notes/trash/topics/:topic_id` clears all trashed notes for one topic and emits `trash.topic_cleared`.
  - When the last trashed note of a deleted topic is permanently removed, the runtime removes that deleted topic row as part of the same ordered event flow.

## Workbench surface ownership

Deck and Workbench reuse released floe-webapp layout/workbench primitives, and Redeven now keeps only a thin product-owned interaction adapter plus business-widget bodies on top of the shared workbench surface.

- Runtime-shared workbench state is intentionally narrow but no longer layout-only: widget identity/type plus geometry (`x`, `y`, `width`, `height`, `z_index`, `created_at_unix_ms`) are shared alongside durable layered canvas objects (`sticky_notes`, `annotations`, and `background_layers`), and a separate widget-state layer also shares only durable semantic widget data (`Files.current_path`, `Terminal.session_ids`, `Preview.current_item`). Viewport pan/zoom, `mode`, `activeTool`, current object/widget selection, transient drag/resize state, dynamic titles, terminal active tab, file-browser `show_hidden` / `page_mode` / `git_subview`, preview cursor/selection/scroll, and unsaved preview draft state stay local to each client.
- Workbench Terminal preserves live UI behavior: multiple visible terminal widgets may keep Ghostty renderers, output subscriptions, and realtime TUI state active at the same time. Env App scales the resize path by coalescing duplicate terminal resize notifications before they reach the shared RPC notify transport instead of silently pausing inactive terminal widgets.
- Workbench Terminal interaction performance follows a live-state / coordinated-frame split. During canvas pan/zoom, widget drag/resize, layer switching, maximize/minimize, creation, and close transitions, Env App keeps every mounted terminal live and relies on `@floegence/floeterm-terminal-web` to batch demand renders through its shared scheduler. PTY output, buffer state, shell integration, tab status, cwd, unread/running state, selection, search, and cursor rendering continue without a snapshot/freeze/catch-up phase; Workbench only tracks layout interaction handles for shell-level visual affordances and owner handoff timing.
- Runtime workbench synchronization is split by ownership: geometry changes still flow through ordered `layout.replaced` snapshot events, while durable widget-internal state flows through ordered `widget_state.upserted` events. This keeps the runtime-authoritative stream deterministic without coupling transient browser UI state to the runtime store.
- Workbench preview opens are runtime commands, not client-fabricated layout edits. `POST /_redeven_proxy/api/workbench/actions/open_preview` chooses same-file reuse, latest-widget reuse, or fresh widget creation inside one runtime transaction, writes the preview target state with the widget shell, and returns the authoritative snapshot plus widget state to the initiating window. File bytes still load asynchronously after the authoritative preview widget mounts, so slow preview rendering cannot remove or race the window topology.
- Remote workbench updates must not move the local camera. Env App reapplies the shared widget scene while preserving each terminal's own viewport and local-only widget interaction state, so cross-terminal consistency covers opened components, their positions, shared Files paths, shared Terminal session membership, and shared Preview targets without stealing the current viewing or editing context.
- Layout persistence is interaction-gated for performance. Drag and resize update only local UI during the live gesture, and Env App flushes one runtime layout PUT after the interaction ends instead of streaming layout writes while the pointer is still moving.
- Widget shell chrome is explicit. Redeven configures the shared workbench shell through its interaction adapter, so shell focus and workbench context-menu interception still happen only from shell-owned affordances instead of the entire widget subtree.
- Widget-local activation stays opt-in and component-owned, and Redeven now consumes the released floe-webapp activation contract instead of mirroring that guard logic locally. A primary body click on a widget-local, non-focusable, non-overlay surface may emit a small `activation` payload to the business widget body, but the shell still does not steal DOM focus from widget-local content. Virtual-input surfaces such as Terminal can use this to reclaim their own internal focus on the first click, while native inputs, buttons, dropdowns, dialogs, and local overlays keep their existing browser/component-owned focus behavior.
- Pointer/context-menu ownership and wheel ownership are separate contracts. `data-floe-local-interaction-surface="true"` descendants still keep local pointer/context-menu ownership unconditionally, while wheel ownership in workbench mode follows the selected-widget guard plus explicit viewport contract: the selected widget boundary blocks canvas zoom, but only a marked, real constrained local scroll viewport may produce `local_surface` scrolling.
- Workbench-local overlays stay upstream and surface-scoped. `Dialog`, `FileContextMenu`, and `Dropdown` now reuse floe-webapp's shared surface portal scope, so portaled menus/submenus still mount inside the active widget host and keep clicks, outside-dismiss, and local hot-interaction boundaries truthful to that widget instead of escaping back to the document body.
- Workbench wheel routing is selection-first but not subtree-scroll-first. Blank canvas and unselected widget bounds keep cursor-centered canvas zoom. Inside the selected widget, explicitly marked local scroll viewports scroll locally; all other selected-widget body regions resolve to `ignore:selected_widget_boundary`, which prevents accidental canvas zoom without pretending that a non-scrollable region can scroll.
- Workbench wheel routing timing is intentionally narrow: browser `wheel` reaches the shared Workbench surface, Redeven's interaction adapter resolves the target widget and selected widget id, terminal early-capture paths call the same resolver, and the final decision is only one of canvas zoom, local surface, or ignore. This keeps Git Browser, Files, Preview, Terminal, Flower/Codex rails, Codespaces, and Web Services on the same data-driven contract.
- Workbench production scroll viewports must use the exported props from `workbenchWheelInteractive.ts`, and `pnpm run check:workbench-wheel` guards against raw wheel attributes or bounded scroll containers without an explicit local-scroll/layout-only role.
- Blank-canvas pointer-down is the explicit deselection boundary for workbench mode, so panning/zooming the scene also clears stale widget selection instead of leaving an invisible local wheel owner behind.
- Heavy workbench widgets now opt into floe-webapp's shared projected-surface path. Files, Terminal, Preview, Codespaces, Flower, and Codex render their business DOM through `renderMode: 'projected_surface'`, while the persisted runtime model remains the same world-space widget geometry and lighter widgets can stay on the default `canvas_scaled` path.
- The projected-surface host itself is upstream-owned and stable-mounted. Released floe-webapp now keeps projected widget bodies keyed by `widget.id`, feeds viewport and shell geometry through shared accessors, and avoids remounting or broad body rerenders during canvas pan/zoom or projected drag updates. Redeven must keep consuming that released contract instead of reviving a local workbench canvas/widget fork, a viewport render callback bridge, or widget-specific throttle patches.
- Header shell affordance is widened on purpose: the entire widget header is draggable, while `Focus`, `Overview`, and `Remove` stay as explicit shell-action buttons that do not start drags.
- Keyboard dismissal stays focus-scoped. `Escape` may close a local dialog/modal only when focus currently lives inside that widget-owned host boundary; it must not broadcast across unrelated widgets or global surfaces.
- Workbench persistence order and CSS stacking stay separated. Persisted `z_index` remains the long-lived ordering key in workbench state, while rendering consumes floe-webapp's normalized dense render layers so app-owned floating surfaces can keep stable semantic layers above widgets even after many bring-to-front operations.
- Workbench multi-instance state is product-owned. Generic floe-webapp workbench state still owns widget geometry, selection, and filters, while Redeven keeps a separate instance-state layer for `latestWidgetIdByType`, local active terminal tab, and other local widget-only affordances so multi-instance routing stays explicit without turning every workbench widget interaction into shared runtime state.
- Workbench Terminal windows are widget-scoped shared session groups rather than mirrored views of one global session strip. Runtime terminal sessions still live in the shared coordinator, each workbench Terminal widget owns one shared visible `session_ids` list, and closing one tab removes only that session from the owning widget so sibling tabs in the same Terminal widget stay intact. The active tab selection itself remains local per window.
- Workbench terminal close is lifecycle-managed by the runtime instead of PTY-bound by the foreground request. The widget `session_ids` list is updated first, the terminal manager marks the target session `closing`, hides it from normal `listSessions` results, rejects attach/input/resize/history/clear/stats for that hidden session, and then cleans up the PTY asynchronously. If cleanup fails, the session stays hidden as `close_failed_hidden`; Env App surfaces a diagnostic notification without restoring the tab to the foreground.
- Workbench Files windows use runtime-shared `current_path` plus local widget-scoped view preferences, so each Files widget stays on the same directory across windows while `show_hidden`, `page_mode`, and `git_subview` remain local to the current client.
- Workbench Preview widgets share only the current preview target. Preview window creation/reuse is committed by the runtime `open_preview` action before the browser renders the widget shell; clean previews follow the synced file immediately, while dirty previews keep the local unsaved draft and show an explicit pending synced file prompt before switching.
- App-owned floating surfaces such as Preview, File Browser, Ask Flower, stash confirmations, and Debug Console must use the centralized `ENV_APP_FLOATING_LAYER` contract instead of raw per-file `z-index` literals. Runtime update prompts are intentionally toast-driven and must not use an app-owned floating window.

## Accessibility baseline

Env App targets a WCAG 2.2 AA baseline. The implementation follows an upstream-first split:

- Shared shell landmarks, skip-link behavior, main-region targeting, dropdown semantics, and generic tab behavior come from released `@floegence/floe-webapp-*` packages.
- Redeven-specific code only handles product-owned surfaces such as the local access gate, AI sidebar, custom tool blocks, git widgets, terminal integration, and file-browser composition.
- Product-owned file-browser composition is also responsible for cross-surface handoffs such as `Open in Terminal` for a selected directory; shared file-browser primitives still only provide generic menu/rendering behavior.
- The shared floating browser host is also product-owned because it coordinates terminal/chat entry points, desktop browser presentation policy, and browser-path seeding on top of the generic `RemoteFileBrowser` surface.

Contributor rules for this surface:

- Prefer upstream primitives and contracts over page-level ARIA patching.
- When a product-owned surface needs panel, overlay, control, segmented, or divider styling, use the local semantic Env App surface/stroke contract instead of raw `border-border/*` tuning in page code.
- Custom file-browser compositions that bypass the standard `FileBrowser` wrapper must mount `FileBrowserDragPreview` from `@floegence/floe-webapp-core/file-browser` whenever drag and drop stays enabled, so the shared drag affordance remains visible.
- Use real buttons, inputs, fieldsets, tabs, and panels for interactive behavior. Do not nest interactive elements.
- Keep visible focus indicators intact. Do not suppress focus rings on terminal, file, or chat surfaces without providing an equally visible replacement.
- When a control behaves like tabs, it must implement tab semantics completely, including roving `tabindex`, arrow key handling, and `aria-controls` / `aria-labelledby` pairing.
- Status and validation feedback should be programmatically associated with the relevant control, and blocking failures should move focus to the surfaced error or recovery target.

Current product-specific accessibility contract:

- The access gate uses explicit labels, help text, error associations, and focused recovery after unlock failures.
- AI thread rows keep thread selection and deletion as separate buttons instead of nested interactive content.
- Tool-call disclosures use a dedicated disclosure button, stable controlled content IDs, and separate approval actions. Web-search domain filters are grouped toggle buttons rather than fake tabs.
- Git view switching and branch subviews use keyboard-complete tablists with roving focus.
- The terminal surface keeps a visible focus treatment. Product-owned terminal, Ask Flower composer, and file-browser controls were audited during this work and intentionally kept on their existing semantic button/input patterns.

## Git browse worktree status

Git browse mode distinguishes between the active repository workspace and per-branch checked-out worktrees:

- The top-level `Changes` view shows the workspace state for the active repository root.
- `Branches -> Status` resolves its own workspace snapshot from an explicit checked-out repository root instead of reusing cached data from `Changes`, and its `Changes` section now follows the same folder-aware scoped-page contract as the top-level workspace view.
- `Changes` is the shared user-facing pending-work category in both places, so `unstaged` and `untracked` entries are grouped together there while row-level metadata still keeps the original Git section visible.
- Workspace rows are now fetched through section-scoped pagination rather than one eager full-workspace snapshot:
  `Changes` pages over `unstaged + untracked`, `Staged` pages over the index snapshot, and `Conflicted` pages over merge-conflict entries.
- Repository summary remains the lightweight source of truth for workspace counts, while each visible section loads only its current page window and can append more rows on demand.
- Manual `Changes` refresh now reloads the visible section in place while invalidating the hidden section caches, so the current table does not fall into a duplicate reload race and later section switches still fetch fresh data.
- `Branches` intentionally keeps its sidebar list as a cached snapshot for responsiveness, but branch detail is now target-truthful: selecting a branch revalidates the requested ref against a fresh `git.listBranches` snapshot before `Status` or `History` is allowed to load.
- If another process deletes the selected branch, Redeven keeps the user anchored on the requested branch identity and renders an explicit stale-selection state with recovery actions (`Refresh branches`, `View current branch`) instead of hanging on a generic loading state or silently jumping selection.
- If branch status/history detail fails after selection because the ref or linked worktree vanished mid-flight, the browser re-runs the same branch reconciliation path so both pre-load and mid-load disappearance collapse into one consistent UX contract.
- For the current branch, branch status uses the active repository root.
- For a linked local branch, branch status uses the branch `worktreePath`.
- For remote branches or local branches without a checked-out worktree, branch status stays unavailable and the UI points users to `Compare` or to opening the branch in a worktree.
- Git browse `Ask Flower` entry points use Git-authored snapshot context instead of pretending commit or workspace summaries are file-browser selections, so Flower receives a clean summary of the selected workspace section or commit metadata/file list.
- The Git `Changes` views are now folder-aware instead of flat pending-file lists: top-level `Changes` and `Branches -> Status -> Changes` both drill into immediate children with breadcrumbs, file rows still open the shared diff dialog, and folder-scoped actions stay truthful to the underlying file set instead of pretending nested directories are already expanded rows.
- The Git `Changes` header is density-aware instead of relying on viewport-only breakpoints: measured pane width selects `comfortable`, `compact`, or `collapsed` presentation, long instructional copy drops out before primary workflow actions, and lower-priority utilities move into overflow rather than squeezing the state summary.
- Clean Git workspace states also keep the header intentionally quiet: irrelevant disabled actions are removed instead of lingering as inactive chrome, comfortable-width clean headers collapse into a single command row instead of leaving a split action gutter, and directory breadcrumbs only appear once the user is actually inside a nested folder while still reusing the collapsed middle-segment pattern on narrow panes.
- Workspace, compare, and commit detail collection RPCs return metadata-only file summaries. Inline diff text is retrieved only when the user opens a specific file dialog, using `getDiffContent` for preview or full-context mode.
- Git diff dialogs keep the embedded `Patch` preview as the default fast path, expose an on-demand `Full Context` mode that re-fetches a single selected file diff with unchanged lines included for broader review context, treat a selected file as an explicit `loading` / `ready` / `error` / `unavailable` state instead of briefly reusing the generic empty-selection copy, and keep selected-file request ownership stable across equivalent parent rerenders.
- Merge commit browsing now uses an explicit first-parent contract for both commit changed-file listings and single-file commit diffs, so every file shown in `Files in Commit` stays openable in `Commit Diff` without relying on repository-local Git merge diff defaults.
- Large Git file tables render through a shared fixed-row virtual table, and the browser no longer downloads metadata for every workspace row up front, so repositories with very large change sets stay responsive.
- Git branch deletion keeps `safe delete` as the default path, but when an unmerged local branch cannot be safely deleted the review dialog can escalate into an exact branch-name-confirmed `force delete`; linked worktrees are force-removed together with their pending changes, while inaccessible linked worktrees remain blocked.

This keeps worktree status consistent even when the user opens `Branches` first without visiting `Changes`.

## Desktop Shell Theme Integration

When Env App runs inside Redeven Desktop, theme ownership stays in the Electron shell rather than in Env App page state.

Contract:

- Env App reads the current shell snapshot from `window.redevenDesktopTheme`.
- Floe `defaultTheme` comes from the shell snapshot source, not from an Env App-only local default.
- The Env App storage adapter intercepts only the persisted Floe `theme` key and maps it onto the shell bridge:
  - `getItem(theme-key)` returns the shell source
  - `setItem(theme-key, ...)` updates the shell source
  - `removeItem(theme-key)` resets the shell source to `system`
- All non-theme UI persistence such as layout and deck state remains owned by the existing Env App storage namespace.
- A small runtime subscription keeps `useTheme()` synchronized when Electron main rebroadcasts a new snapshot, including OS theme changes while the user preference is `system`.
- Env App keeps an explicit entry-document fallback on `html`, `body`, and `#root` so the shell-owned native window background and the first renderer frame stay aligned before feature surfaces mount.

Implications:

- Env App theme toggles behave like shell-wide toggles, not page-local overrides.
- Session child windows opened through allowed app navigation inherit the same theme snapshot and document-class synchronization path as the main Env App window.
- Eliminating independent page authority for native window colors avoids light flashes during dark-mode open, close, and aggressive resize transitions.
- Renderer CSS may still use richer theme tokens, but native window colors remain a shell-owned hex contract instead of flowing arbitrary CSS color syntax back into Electron.

## Desktop Floating Surface Model

Desktop Env App surfaces now follow one canonical in-app presentation model for product-owned tools.

Contract:

- File preview always renders through `FilePreviewHost` inside the main Env App shell and keeps copy/edit/save/discard plus Ask Flower in the same renderer tree.
- Debug Console always renders through the shared in-app `DebugConsoleWindow`, so enable/minimize/restore stays local to the active Env App shell.
- File Browser keeps using the shared floating browser surface host instead of a second presentation path.
- Ask Flower from preview now stays entirely in-process inside the root Env App shell instead of handing off through Electron IPC between windows.

Implications:

- Product-owned floating tools have one renderer path per feature instead of a parallel in-app plus child-window split.
- Desktop child windows remain available only for legitimate top-level navigation flows that belong to separate browser windows, not for internal floating tools.

## Git browse stash workflow

Git stash stays a workflow overlay owned by Git browse rather than a separate primary navigation mode:

- Desktop uses the shared floating `PreviewWindow`; mobile reuses the same surface as a full-screen dialog.
- The header `Stashes` action opens the `Saved Stashes` tab and shows the current stash count badge from repository summary data.
- `Changes -> Stash...` targets the active repository root.
- `Branches -> Status -> Stash...` targets the selected checked-out branch worktree (`worktreePath` when present, otherwise the active repository root for the current branch).
- Merge review blockers no longer rely on message parsing. The merge preview returns structured blocker metadata, and the dialog only shows `Stash current changes` when the blocker explicitly exposes a stashable workspace path.
- The `Save Changes` tab boots from repository summary data only. It reads workspace counts from `workspaceSummary` and does not preload the full workspace file list before the user decides to stash.

The stash surface itself is split into two tabs:

- `Save Changes` shows the target repository/worktree context, current workspace summary, optional stash message, and explicit `Include untracked files` / `Keep staged changes ready to commit` options.
- `Saved Stashes` shows a lightweight shared stash summary list first, then loads metadata-only detail for the selected stash, a compact changed-files table, and guarded actions for `Apply`, `Apply & Remove`, and `Delete`.
- Stash detail returns file metadata first; clicking a changed file opens the shared `GitDiffDialog`, which fetches `getDiffContent` lazily for preview/full-context review instead of forcing an inline patch split inside the stash surface.

Safety and refresh behavior:

- Stash entries use the stash commit OID as their stable identity, so selection survives index shifts like `stash@{0}` changing after new saves or deletions.
- `Apply` and `Delete` both require preview fingerprints before mutation; stale plans are rejected. `Delete` uses a dedicated confirmation dialog so the second step stays visible even when the stash detail panel is scrolled, and it refreshes the stash context when the plan goes stale so the user can confirm again without manually reopening the stash window.
- Desktop floating-window-owned confirmations such as stash delete and file-preview discard now use a window-scoped modal layer. The backdrop and confirmation content stay inside the owning floating window instead of dropping into the global page dialog stack.
- Stash apply preview simulates the operation in a temporary detached worktree before enabling confirmation, so clean-apply checks do not depend on string heuristics in the visible worktree.
- After stash mutations, the stash window refreshes its own target worktree context, while the main Git browser refreshes repository summary plus the currently active paged workspace section instead of forcing a full workspace reload or switching to the wrong worktree root.

## What runs where

Browser side:

- A sandbox bootstrap window (`env-<env_id>.<region>.<base-sandbox-domain>`, for example `env-demo.dev.redeven-sandbox.test`) creates a runtime-mode proxy:
  - A Service Worker forwards `fetch()` to the proxy runtime via `postMessage + MessageChannel`.
  - The runtime forwards HTTP/WS traffic over Flowersec E2EE to the Redeven runtime.
- The bootstrap then loads the Env App UI via a same-origin iframe:
  - `/_redeven_proxy/env/`
- This same-origin iframe pattern is specific to the trusted Env App origin.
  - When that iframe is hosted inside Redeven Desktop remote sessions, Env App publishes desktop drag-region rectangles for its header, while the Desktop session preload in the top-level document owns the actual native drag overlays.
  - Codespace windows and remote Web Service tunnel windows opened from Env App use a different path:
    a trusted launcher origin -> an isolated runtime origin -> an untrusted app origin.
  - The untrusted app never runs on the same origin as the Env App runtime window.
- In Local UI mode, Web Services can also open through the same Local UI origin at `/pf/<forward_id>/`. That route is protected by the Local UI access gate and proxies to the registered target from the runtime host, so SSH and URL access modes do not leak a remote `localhost` assumption into the user's browser.

Runtime side:

- The runtime serves Env App static assets under `/_redeven_proxy/env/*` via the local gateway.
- The per-session local access proxy must preserve the browser-visible external origin context (`Host` / projected scheme / browser `Origin`) when forwarding to the gateway.
- Session binding for gateway APIs is carried on a trusted runtime-local hop (`X-Redeven-Session-Channel`) instead of overloading the browser-visible sandbox host labels.
- The Env App UI talks to the runtime using **Flowersec RPC/streams** (fs/terminal/monitor domains).
- Codex uses a separate browser-facing gateway contract under `/_redeven_proxy/api/codex/*`; the browser never connects directly to `codex app-server`, and the runtime resolves the host `codex` binary on demand instead of mirroring Codex runtime defaults into `config.json`.
- Codex transcript scrolling uses an explicit follow-bottom controller: thread switches and sends re-enter follow mode, late transcript reflow keeps the viewport at the latest output while following, and manual user scroll-away pauses bottom following until the user returns near the bottom or triggers a new explicit bottom intent.
- Codex-only bottom intents are split by semantics: system restore paths (`bootstrap`, `thread_switch`) stay instant, while explicit user intents (`send`, manual return-to-bottom) may animate smoothly when reduced motion is not requested.
- The Codex controller follows the real bottom scroll target (`scrollHeight - clientHeight`) and keeps this behavior scoped to the Codex surface, so Flower and other Env App pages do not inherit the motion change.
- Flower assistant live rendering strictly separates the settled transcript from the in-flight assistant surface. Persisted transcript rows stay in the virtualized message list, while the active assistant run renders through one dedicated non-virtualized tail surface inside the same scroll container until transcript persistence catches up.
- Flower assistant live output no longer creates synthetic pending transcript messages, transient display rows, or frontend-only message-id adoption. Empty output, hidden-only `thinking`, visible answer text, recovery snapshots, and terminal handoff are inner states of the same mounted live surface.
- Flower assistant live output keeps `thinking` hidden from the default transcript view. Before transcript persistence catches up, visible live answer text may render inline as live content; settled markdown rendering remains a transcript concern once the canonical assistant message lands.
- Active-run snapshots are recovery-only input for the live assistant tail. If the persisted transcript already contains the same assistant `message.id`, the UI must suppress the live tail and rely on the settled transcript row only.
- Run progress is shown on the active live assistant tail through the message ornament contract. The ornament component and avatar shell must stay stably mounted across streaming deltas so the UI does not flash while the phase label updates.
- Transcript-only affordances such as message timestamps and copy actions stay attached to settled transcript messages. The live assistant tail hides those footer actions until the canonical transcript row replaces it.
- Follow-bottom and virtualization operate on transcript rows only. Live-tail growth can still move the scroll height, but it must not mutate the virtual row-height cache or force transcript row remounts during streaming.
- Flower follow-bottom uses motion-aware intents: explicit user bottom intents such as send/return-to-bottom may animate into the latest output, while system restore paths such as thread switch, refresh bootstrap, transcript reset, and baseline recovery must stay instant.
- Flower's Env App composer now uses a transparent bottom-dock shell plus a centered floating card surface instead of a solid footer panel, but it still remains in normal document flow rather than covering the transcript.
- Flower transcript clearance for that floating composer is measured from the real bottom-dock height and written back into the transcript inset contract, so autosizing textareas, attachment strips, pending-input rails, and mobile safe-area changes cannot hide the newest visible transcript output under the composer.
- Detached desktop child windows keep using the same Env App runtime, access gate, and Flowersec protocol path; only the scene rendered inside the window changes.
- Terminal initializes new users with the `Dark` color theme and `Monaco` font while still preserving any saved per-user overrides.
- On mobile, Terminal defaults to the built-in Floe keyboard, keeps taps from auto-triggering the system IME in Floe mode, and offers suggestion rails for recent commands, common commands, scripts, and paths. The default mobile input mode is chosen in Terminal settings as a strict `Floe Keyboard` / `System IME` toggle, while the More menu only exposes temporary show/hide actions when Floe Keyboard mode is active. Floe Keyboard stays as a bottom overlay, the terminal viewport aligns itself to the measured keyboard inset instead of reserving a separate blank spacer above it, and vertical touch drags on the terminal surface are translated into native terminal scrolling on mobile.

## Session bootstrap contract used by the Env App UI

The Env App UI runs on sandbox origins and consumes a short-lived control-plane bootstrap contract. Public implementations should treat the control plane as the authority that issues browser bootstrap credentials and runtime connection artifacts. The wire-level runtime control-plane protocol is documented in [`protocol/rcpp-v1.md`](protocol/rcpp-v1.md) and [`openapi/rcpp-v1.yaml`](openapi/rcpp-v1.yaml).

- Browser bootstrap credentials are short-lived and origin-scoped.
- Runtime connection artifacts are minted on demand and used by Flowersec to establish the encrypted runtime session.
- The shared browser bootstrap helper layer for artifact fetching, reconnect config assembly, and default `proxy.runtime` scope validation is now consumed from released `@floegence/floe-webapp-boot`; Redeven keeps runtime preflight, Local UI direct artifacts, access resume, and recovery UX as product-owned logic.
- In Local UI mode, the browser still uses the same canonical shape: Local UI mints a direct-transport runtime connection artifact, and the Env App reconnect contract stays artifact-first even though the underlying transport is direct instead of tunnel.

Security baseline:

- Env App UI never stores long-lived capability credentials in browser storage.
- High-value credentials are HttpOnly cookies scoped to the sandbox origin.
- One-time browser bootstrap credentials are exchanged on demand with short TTL.
- If sandbox session context is missing or expired, the browser must return to the control plane for re-issuance.

## Reconnect recovery strategy

Env App reconnect recovery is intentionally split into two layers:

1. **Transport fast retries**

   - Flowersec transport reconnect keeps a small bounded retry budget for short websocket/tunnel blips in both remote tunnel mode and local direct mode.
   - This path is optimized for brief network hiccups and quick runtime restarts.

2. **App-level waiting loop**

   - If fast retries are exhausted, Env App switches into an explicit waiting state instead of hammering full reconnect attempts.
   - `EnvAppShell` owns the only waiting coordinator; maintenance and page-level widgets do not start their own reconnect loops.
   - The shell polls runtime availability with a single-flight backoff timer and only launches controlled reconnect probes.
   - Remote mode probes environment status from the control plane.
   - Local direct mode probes Local UI availability plus local access-gate state from `/api/local/access/status`.
   - Manual retries and lifecycle nudges (`online`, `focus`, `visibilitychange`) reuse the same coordinator so the UI never spawns parallel reconnect loops.

3. **Secure-session recovery**
   - Transport recovery and access-gate recovery stay separate.
   - After reconnect, Env App re-checks the secure session authoritatively instead of trusting stale browser-side unlocked state.
   - If the runtime restart invalidates the previous resume token or local access session, the same page switches back to the in-place password prompt without requiring a manual refresh.

UI contract:

- `Connecting to runtime...`
  - initial session establishment
- `Reconnecting to runtime...`
  - transport fast retry or an explicit hard reconnect probe is in flight
- `Waiting for runtime...`
  - prolonged outage / restart window after offline-like failures
- `Preparing secure session`
  - transport is back, but the access-gate password/session resume handshake is still running

Design goals:

- keep transient recovery fast,
- bound control-plane pressure during prolonged downtime,
- distinguish runtime unavailability from secure-session recovery,
- let the same reconnect contract cover remote tunnel mode and local direct mode,
- keep reconnect policy centralized in the Env App shell instead of scattering timers across pages.

## Audit log

There are **two** audit log sources:

1. Redeven service-side session audit log.

   - This is **not** shown in the Env App.
   - It is surfaced in the Redeven web app for environment admins.

2. Runtime-local audit log (user operations): recorded and persisted by the runtime.
   - Env App reads it via the local gateway API (env admin only):
     - `GET /_redeven_proxy/api/audit/logs?limit=<n>`
   - Storage (JSONL + rotation):
     - `<state_dir>/audit/events.jsonl`
     - `state_dir` is the directory of the runtime config file (default: `~/.redeven/`)
   - The log is metadata-only and must not contain secrets (PSK/attach token/AI secrets/file contents).
   - If present, `tunnel_url` is transport routing metadata only. It must not be interpreted as the authorization scope for the session.

## Diagnostics mode

Diagnostics is an infrastructure capability of the local runtime. The floating Debug Console is a frontend-only surface layered on top of that diagnostics stream.

Behavior:

- Runtime-side request/direct-session diagnostics are stored separately from audit logs:
  - `<state_dir>/diagnostics/agent-events.jsonl`
- Desktop builds that attach to the same runtime may also write:
  - `<state_dir>/diagnostics/desktop-events.jsonl`
- Local UI and gateway share a single trace header:
  - `X-Redeven-Debug-Trace-ID`
- Local UI and gateway also expose the runtime collector state through:
  - `X-Redeven-Debug-Console-Enabled`
- Runtime Settings exposes `Debug Console` under the dedicated `Diagnostics` group instead of mixing it into Logging, and the floating console reads data through:
  - `GET /_redeven_proxy/api/debug/diagnostics`
  - `GET /_redeven_proxy/api/debug/diagnostics/export`
  - `GET /_redeven_proxy/api/debug/diagnostics/stream`
- Browser-local rendering telemetry such as FPS, long tasks, layout shifts, and heap usage stays in the Env App shell, starts while the Debug Console is visible, and is merged into the exported debug bundle without being persisted back into the runtime state directory.

The diagnostics stream is timing-focused and must remain separate from the audit log because it is intended for troubleshooting performance and startup issues rather than user-operation auditing.

## Codespaces (code-server) management

The Env App UI manages local codespaces via the local runtime gateway API:

- `GET /_redeven_proxy/api/spaces`
- `POST /_redeven_proxy/api/spaces`
- `POST /_redeven_proxy/api/spaces/:id/start`
- `POST /_redeven_proxy/api/spaces/:id/stop`
- `DELETE /_redeven_proxy/api/spaces/:id`
- `GET /_redeven_proxy/api/code-runtime/status`
- `POST /_redeven_proxy/api/code-runtime/install`
- `POST /_redeven_proxy/api/code-runtime/select`
- `POST /_redeven_proxy/api/code-runtime/remove-version`
- `POST /_redeven_proxy/api/code-runtime/cancel`

When opening a codespace, the Env App mints a one-time ticket for `com.floegence.redeven.code`, then opens:

- `https://cs-<code_space_id>.<region>.<base-sandbox-domain>/_redeven_boot/#redeven=<b64url(init)>`

Notes:

- Codespace/3rd-party app windows never receive long-lived control-plane credentials. They only get short-lived bootstrap credentials scoped to the requested app launch.
- In normal browser sessions, Env App still uses a pre-opened popup/tab so user-triggered navigation stays within browser popup-blocker rules.
- In Redeven Desktop, Codespaces `Open` does not stay inside Electron. Env App asks the desktop shell bridge to open the final Codespaces URL in the system browser, while keeping the same short-lived bootstrap contract.
- If the desktop-managed Local UI is password-protected, the first protected Local UI request can still start from a `redeven_access_resume` token. Local UI exchanges that resume token into the standard local access cookie before returning the protected Codespaces page so later same-origin asset requests do not need to keep carrying the token.
- If a codespace window is refreshed after the hash is cleared, it can request a fresh bootstrap credential from the opener Env App via `postMessage` handshake.
- If the desktop-opened browser window no longer has an opener, the trusted launcher still keeps `?env=` so the existing independent-open recovery flow can redirect back through the control plane / Env App bootstrap when needed.
- Codespaces cards also expose right-click `Ask Flower` and `Open in Terminal` actions. `Ask Flower` stays first to match the broader Env App handoff ordering, while `Open in Terminal` opens a terminal session rooted at `workspace_path`. The `Ask Flower` action sends that same `workspace_path` as directory context so the composer keeps the same folder-oriented prompt copy used by File Browser directory launches.
- Codespaces does **not** auto-install `code-server`. When the runtime is missing or unusable, Env App shows an explicit install UI and waits for the user to click `Install and use for this Local Environment` or `Install latest and use for this Local Environment`.
- Runtime Settings -> `Codespaces & Tooling` also exposes a dedicated `code-server Runtime` management card. It separates steady runtime status from transient management activity:
  - when no usable runtime is available, Settings renders a compact installable state instead of a dense `Not detected` table dump,
  - the steady state clearly separates `Current Local Environment`, `Installed for this Local Environment`, and `Recent runtime operation`,
  - users can reuse an installed version for the current Local Environment or remove one Local Environment version when it is not selected,
  - while install or Local Environment version removal is running, Settings switches to a focused operation panel with optional recent output,
  - after a successful install or Local Environment version removal, Settings returns to the normal steady state instead of leaving a persistent success audit block on screen,
  - failed or cancelled actions keep their recent output visible so the user can recover explicitly.
- The Codespaces install flow displays the same explicit source and progress details inside Env App before the user continues to the pending `Start` or `Open` action.

## Build

Env App UI sources:

- `internal/envapp/ui_src/`

Build output (embedded by Go `embed`):

- `internal/envapp/ui/dist/env/*`

Build (recommended):

```bash
./scripts/build_assets.sh
```

Note: `internal/envapp/ui/dist/` is generated and not checked into git.
