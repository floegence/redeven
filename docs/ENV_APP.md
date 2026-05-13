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
- Runtime Settings groups endpoint controls by user intent: overview/runtime status, runtime configuration, Codespaces tooling, security, AI/extensions, and diagnostics.
- Web Services is the user-facing registry for HTTP services reachable from the runtime host. Same-device local mode can open safe loopback targets directly; URL/SSH Local UI sessions use `/pf/<forward_id>/`; remote Provider sessions use the isolated Flowersec E2EE port-forward tunnel.
- Codex is a separate optional AI runtime with its own activity-bar entry and gateway namespace. It is not a Flower mode/provider, and Runtime Settings reports Codex host status without persisting Codex approval, sandbox, model, or binary defaults.
- File Browser keeps Monaco as the single text preview/edit surface where possible, treats symbolic links explicitly, and enforces `fs/read_file` as file-only before raw bytes are streamed.
- Terminal sessions are runtime-owned and may be attached by multiple Env App surfaces; only the focused surface emits resize ownership updates after attach.
- Desktop-managed runs keep Preview, File Browser, Ask Flower, and Debug Console inside the main Env App window as product-owned floating surfaces. Browser-app windows such as Codespaces remain separate navigation flows.

## Notes overlay

Env App exposes a product-owned **Notes overlay** above the current workspace instead of adding another top-level activity page.

- Notes opens from the shell top bar or `Cmd/Ctrl+.` and remains non-modal over the current workspace.
- Opening Notes does not steal focus from the user's current editor/input; editing starts only after an explicit note action.
- A fresh runtime seeds a default `Welcome` topic and note.
- Notes use a runtime-authoritative snapshot + SSE stream under `/_redeven_proxy/api/notes/*`, so connected clients converge on the same topics, notes, style tokens, and trash state.
- Deleted notes move to runtime-managed trash with a fixed 72-hour retention window before permanent removal.

## Workbench surface ownership

Deck and Workbench reuse released floe-webapp layout/workbench primitives. Redeven keeps product-owned interaction adapters and business-widget bodies on top of those shared surfaces.

- Runtime-shared state is deliberately narrow: widget identity/type, geometry, ordering, durable canvas objects, and semantic widget data such as Files current path, Terminal session ids, and Preview target.
- Per-client camera, shell mode, selection, transient gestures, active terminal tab, file-browser view preferences, preview cursor/scroll, and unsaved drafts stay local.
- Geometry changes and widget semantic state flow through ordered runtime snapshot/event streams. Preview opens are runtime commands, not client-fabricated layout edits.
- Remote Workbench updates must not move the local camera or steal current editing context.
- Drag/resize persistence is interaction-gated: the browser updates live UI during the gesture and flushes one runtime write after the interaction ends.
- Widget shell chrome and widget-local content remain separate. Shell affordances own selection, drag, focus/overview/remove, and shell context menus; widget bodies own local focus, dialogs, dropdowns, text selection, and component context menus.
- Wheel routing is selection-first: blank canvas and unselected widgets keep canvas zoom; selected widget boundaries block canvas zoom; only explicit local scroll viewports scroll locally.
- Production local scroll candidates must use the exported Workbench wheel props so the static `check:workbench-wheel` gate can catch accidental bypasses.
- Heavy widgets such as Files, Terminal, Preview, Codespaces, Flower, and Codex use floe-webapp's projected-surface render path while preserving the same world-space layout model.
- App-owned floating surfaces such as Preview, File Browser, Ask Flower, stash confirmations, and Debug Console use the centralized `ENV_APP_FLOATING_LAYER` contract.

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

- A trusted bootstrap origin creates the runtime-mode proxy and loads the Env App UI from `/_redeven_proxy/env/`.
- Browser `fetch()` / WebSocket traffic is forwarded through the proxy runtime and then over Flowersec E2EE to the Redeven runtime.
- Trusted Env App documents may use a same-origin iframe pattern; untrusted app windows such as Codespaces and remote Web Services use a separate launcher/runtime/app-origin split.
- In Local UI mode, Web Services can also open through `/pf/<forward_id>/`, protected by the Local UI access gate and resolved from the runtime host.

Runtime side:

- The runtime serves Env App static assets under `/_redeven_proxy/env/*` via the local gateway.
- The per-session local access proxy must preserve the browser-visible external origin context (`Host` / projected scheme / browser `Origin`) when forwarding to the gateway.
- Session binding for gateway APIs is carried on a trusted runtime-local hop (`X-Redeven-Session-Channel`) instead of overloading the browser-visible sandbox host labels.
- The Env App UI talks to the runtime using **Flowersec RPC/streams** (fs/terminal/monitor domains).
- Codex uses a separate browser-facing gateway contract under `/_redeven_proxy/api/codex/*`; the browser never connects directly to `codex app-server`, and the runtime resolves the host `codex` binary on demand instead of mirroring Codex runtime defaults into `config.json`.
- Flower and Codex keep independent gateway, controller, transcript, and follow-bottom contracts. Flower's settled transcript and live assistant tail are separate surfaces; Codex projects host app-server state into its own thread/session model.
- Detached desktop child windows keep using the same Env App runtime, access gate, and Flowersec protocol path; only the scene rendered inside the window changes.
- Terminal initializes new users with the `Dark` color theme and `Monaco` font while still preserving any saved per-user overrides.
- On mobile, Terminal defaults to the built-in Floe keyboard, exposes a strict `Floe Keyboard` / `System IME` setting, and translates terminal touch drags into native terminal scrolling.

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

Notes:

- Codespace windows receive only short-lived bootstrap credentials scoped to the requested app launch.
- Browser sessions use a user-triggered popup/tab flow to satisfy popup-blocker rules.
- Redeven Desktop opens Codespaces in the system browser while preserving the same short-lived bootstrap contract.
- Password-protected Desktop-managed Local UI can resume the first protected Codespaces request through `redeven_access_resume`, then exchange it for the normal local access cookie.
- Codespace cards expose right-click `Ask Flower` and `Open in Terminal` actions rooted at `workspace_path`.
- Codespaces does **not** auto-install `code-server`. Missing or unusable runtime state is handled by explicit install/select UI in Codespaces and Runtime Settings -> `Codespaces & Tooling` -> `code-server Runtime`.
- Runtime management UI separates steady inventory/status from transient install, remove, cancel, failure, and recovery activity. See [`CODE_APP.md`](CODE_APP.md) for the full managed code-server contract.

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
