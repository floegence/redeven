# Env App (env details UI over Flowersec E2EE)

This document describes the **Env App** implementation in the Redeven agent.

Key points:

- The Env App UI is **agent-bundled** (built + embedded into the agent binary).
- The browser accesses it over a **Flowersec E2EE proxy** (runtime mode).
- Env details features live here (Deck/Terminal/Monitor/File Browser/Codespaces/Ports/Flower/Codex).
- Codex is a separate optional AI runtime with its own activity-bar entry and gateway namespace; it is not implemented as a Flower mode, provider, or sub-page.
- Agent Settings -> Codex is a read-only host/runtime status panel. Redeven does not persist Codex approval, sandbox, model, or binary configuration in agent settings.
- The Codex sidebar/page use floe-webapp layout and form primitives for visual consistency, but Codex state, icon assets, thread navigation, transcript projection, and request handling stay implemented as a separate surface rather than as Flower extensions.
- The Codex surface is structured as a dedicated conversation navigator plus chat shell, intentionally following the same high-level sidebar + transcript + bottom composer rhythm as Flower while keeping the implementation fully Codex-local.
- When host Codex is missing, the Codex surface remains navigable for diagnostics, but host-backed actions inside the surface switch into an explicitly disabled state with a shared reason instead of pretending a new chat can still start.
- The Codex chat shell now reads a Codex-only capability snapshot from the gateway (`/_redeven_proxy/api/codex/capabilities`) so the composer can expose host-valid model, reasoning-effort, approval, and sandbox controls without borrowing Flower runtime state.
- Codex composer controls stay below the chat input and remain scoped to `src/ui/codex/*` selectors only, so mobile-density, sidebar stability, and transcript alignment updates do not affect Flower page styling or logic.
- Codex visual styling is intentionally flat and workstation-like: `src/ui/codex/codex.css` owns a Codex-local semantic surface token family and Codex-scoped overrides for inherited shared chat selectors, while decorative gradients and radial highlights are intentionally excluded from the Codex chat page.
- Codex branding now hardens its runtime icon path by preferring bundled artwork and falling back to an inline glyph, so embedded Env App builds never show a browser broken-image placeholder.
- Codex markdown keeps the existing standard-link and local-file-reference DOM structure, preserves local file-reference labels that include embedded line anchors such as `CODEX_UI.md#L121`, and consumes the shared floe-webapp file-reference chip styling instead of maintaining a Codex-only outline variant.
- Env App owns a root-scoped paired surface/stroke theme contract: `--redeven-surface-panel*` defines the standard light/dark panel family, matching `--redeven-stroke-*` tokens define panel, overlay, control, and divider borders, and shared `card` / `popover` surfaces plus Flower chat consume that same contract so body portals and in-tree panels stay visually aligned.
- Flower chat keeps model-picking scope explicit: the draft chat picker updates the default model for future new chats, active unlocked threads edit only their own thread model, and locked threads show a read-only model badge instead of a misleading editable control.
- Flower thread history keeps the chat `title` separate from the latest `last_message_preview` snippet: untitled chats render as `New chat` until the agent later writes a generated title, while the preview line continues to reflect the newest visible message text.
- Flower thread runtime metadata also records `last_context_run_id`, letting completed chats recover the latest context summary without depending on transient live-run state in the current page session.
- Flower auto titles are best-effort but resilient: the agent retries transient generation failures in the background, can expand the title-generation output budget once for reasoning-heavy models, falls back to a truncated first user message after three failed generation passes, and also recovers recent untitled threads after restart, so users should see a usable title appear without manual refresh or rename in normal cases.
- File Browser keeps Monaco as the single text surface for both preview and edit, so read-only and editable text/code views stay visually and behaviorally aligned without branching on syntax-support gaps.
- When a supported code file switches from read-only preview into Edit mode, Env App intentionally remounts the Monaco instance instead of only flipping `readOnly`; this lifecycle boundary prevents stale preview state from leaking into editability.
- If Monaco cannot start while the user is entering Edit mode, Env App shows an explicit editor-unavailable state instead of silently dropping back to a fake editable fallback.
- When the environment grants `can_write`, text previews can switch into Monaco-backed edit mode and save changes back through the agent file RPC.
- File Browser directory context menus can hand off into Terminal by opening the terminal page and creating a new session rooted at the selected directory.
- Terminal session creation is dormant-first: `createSession` records the logical session, the first terminal attach starts the PTY with the measured viewport, and the terminal surface performs one explicit post-attach resize confirmation after mount so remote size converges to the settled visible viewport instead of a provisional fallback.
- Terminal size handoff is focus-driven after attach: when multiple surfaces can reopen the same session, only the focused surface is allowed to emit remote resize updates, and regaining focus re-fits plus re-emits the settled viewport so the active surface can reclaim remote PTY ownership from a previously active narrower or wider surface.
- Codespaces cards can hand off from their right-click menu into Terminal and Ask Flower, reusing the same directory-level actions used by File Browser folders.
- Terminal right-click menus can hand off back into File Browser by opening the shared floating browser surface at the active terminal working directory.
- Env App right-click menus that expose cross-surface handoff actions keep a shared priority order: `Ask Flower` first, `Open in Terminal` second when present, `Browse files` next when present, then a separator before any remaining actions.
- Git browser cards now follow the same helper-action ordering where it makes semantic sense: `Changes` exposes `Ask Flower`, `Open in Terminal`, and `Browse Files`; `Branches` exposes directory handoffs only when the selected branch resolves to a checked-out worktree; `Graph` exposes commit-scoped `Ask Flower` plus `Switch --detach here`, branch-history commit detail exposes the same detach action, and detached repository chrome now shows explicit `Detached HEAD` state plus a one-click `Checkout <branch>` action back to the latest attached local branch when checkout history can resolve one safely.
- `Branches` also keeps its narrow-screen chrome intentionally compact: empty branch summaries are omitted instead of reserving placeholder space, branch subview tabs take a dedicated row on narrow layouts but realign to the branch header's right edge on wide screens without collapsing the workspace/action rail into that same row, workspace/actions controls wrap in self-contained groups so labels never detach from their buttons, and the status-section picker stays a segmented strip so the changed-file table reaches the viewport sooner.
- Git browser title dots are a semantic chrome contract rather than ad-hoc Tailwind background utilities: `src/ui/widgets/GitChrome.ts` maps `GitChromeTone` to stable `git-tone-dot--*` classes, while `src/styles/redeven.css` owns the final light/dark pigment tokens so agent-bundled production CSS cannot silently drop those markers.
- Git stash is implemented as one shared floating Git surface instead of a fourth top-level browse mode: the header `Stashes` badge opens the saved-stack review tab, `Changes` and `Branches -> Status` open the save tab for the correct worktree target, and merge blockers can deep-link directly into `Stash current changes` when structured blocker data says the workspace can be stashed.
- Git collection RPCs now keep file lists metadata-only; the UI resolves selected file patches lazily through a single `getDiffContent` contract instead of embedding `patch_text` into workspace, compare, commit, or stash collection payloads.
- Large Git file tables use shared virtualization in the Env App (`Changes`, `Branches -> Compare`, `Branches -> Status`, and `Graph` commit files), while stash review remains summary-first and fetches patch content only for the actively selected file.
- CSS, HTML, SCSS, Less, TOML, Makefile-family files, Vue/Svelte-class files, and other text formats now stay on the same Monaco-backed preview/edit path instead of splitting by language support tables.
- File preview no longer uses a separate Shiki renderer. The only remaining preview fallbacks are a plain-text truncated view and a plain-text emergency view when Monaco fails outside edit mode.
- Desktop-managed runs can promote serializable overlay surfaces into dedicated desktop child windows by reopening the same Env App entrypoint in a detached-scene mode (`file_preview` and `file_browser` today).
- The page browser, detached file-browser scene, Ask Flower linked-directory browser, and Flower chat floating browser all reuse the same `RemoteFileBrowser` surface; chat-specific code only owns the floating-shell behavior that opens it.
- Env App now keeps the reusable chat/terminal floating browser shell at the root level, so cross-surface entry points share the same detached fallback, persistence, and explicit browser-seed handling.

## Accessibility baseline

Env App targets a WCAG 2.2 AA baseline. The implementation follows an upstream-first split:

- Shared shell landmarks, skip-link behavior, main-region targeting, dropdown semantics, and generic tab behavior come from released `@floegence/floe-webapp-*` packages.
- Redeven-specific code only handles product-owned surfaces such as the local access gate, AI sidebar, custom tool blocks, git widgets, terminal integration, and file-browser composition.
- Product-owned file-browser composition is also responsible for cross-surface handoffs such as `Open in Terminal` for a selected directory; shared file-browser primitives still only provide generic menu/rendering behavior.
- The shared floating browser host is also product-owned because it coordinates terminal/chat entry points, detached desktop promotion, and browser-path seeding on top of the generic `RemoteFileBrowser` surface.

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
- `Branches -> Status` resolves its own workspace snapshot from an explicit checked-out repository root instead of reusing cached data from `Changes`.
- `Changes` is the shared user-facing pending-work category in both places, so `unstaged` and `untracked` entries are grouped together there while row-level metadata still keeps the original Git section visible.
- Workspace rows are now fetched through section-scoped pagination rather than one eager full-workspace snapshot:
  `Changes` pages over `unstaged + untracked`, `Staged` pages over the index snapshot, and `Conflicted` pages over merge-conflict entries.
- Repository summary remains the lightweight source of truth for workspace counts, while each visible section loads only its current page window and can append more rows on demand.
- Manual `Changes` refresh now reloads the visible section in place while invalidating the hidden section caches, so the current table does not fall into a duplicate reload race and later section switches still fetch fresh data.
- For the current branch, branch status uses the active repository root.
- For a linked local branch, branch status uses the branch `worktreePath`.
- For remote branches or local branches without a checked-out worktree, branch status stays unavailable and the UI points users to `Compare` or to opening the branch in a worktree.
- Git browse `Ask Flower` entry points use Git-authored snapshot context instead of pretending commit or workspace summaries are file-browser selections, so Flower receives a clean summary of the selected workspace section or commit metadata/file list.
- Workspace, compare, and commit detail collection RPCs return metadata-only file summaries. Inline diff text is retrieved only when the user opens a specific file dialog, using `getDiffContent` for preview or full-context mode.
- Git diff dialogs keep the embedded `Patch` preview as the default fast path, and now also expose an on-demand `Full Context` mode that re-fetches a single selected file diff with unchanged lines included for broader review context.
- Large Git file tables render through a shared fixed-row virtual table, and the browser no longer downloads metadata for every workspace row up front, so repositories with very large change sets stay responsive.
- Git branch deletion keeps `safe delete` as the default path, but when an unmerged local branch cannot be safely deleted the review dialog can escalate into an exact branch-name-confirmed `force delete`; linked worktrees are force-removed together with their pending changes, while inaccessible linked worktrees remain blocked.

This keeps worktree status consistent even when the user opens `Branches` first without visiting `Changes`.

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
- `Saved Stashes` shows the shared stash stack, stash detail, changed-file patch browsing, and guarded actions for `Apply`, `Apply & Remove`, and `Delete`.
- Stash detail returns file metadata first; the selected stash file patch is fetched lazily through `getDiffContent` when the user focuses that file.

Safety and refresh behavior:

- Stash entries use the stash commit OID as their stable identity, so selection survives index shifts like `stash@{0}` changing after new saves or deletions.
- `Apply` and `Delete` both require preview fingerprints before mutation; stale plans are rejected and must be reviewed again.
- Stash apply preview simulates the operation in a temporary detached worktree before enabling confirmation, so clean-apply checks do not depend on string heuristics in the visible worktree.
- After stash mutations, the stash window refreshes its own target worktree context, while the main Git browser refreshes repository summary plus the currently active paged workspace section instead of forcing a full workspace reload or switching to the wrong worktree root.

## What runs where

Browser side:

- A sandbox bootstrap window (`env-<env_id>.<region>.<base-sandbox-domain>`, for example `env-demo.dev.redeven-sandbox.test`) creates a runtime-mode proxy:
  - A Service Worker forwards `fetch()` to the proxy runtime via `postMessage + MessageChannel`.
  - The runtime forwards HTTP/WS traffic over Flowersec E2EE to the agent.
- The bootstrap then loads the Env App UI via a same-origin iframe:
  - `/_redeven_proxy/env/`
- This same-origin iframe pattern is specific to the trusted Env App origin.
  - Codespace and port-forward windows opened from Env App use a different path:
    `cs-*` / `pf-*` trusted launcher -> `rt-*` controller origin -> `app-*` untrusted app origin.
  - The untrusted app never runs on the same origin as the Env App runtime/controller window.

Agent side:

- The agent serves Env App static assets under `/_redeven_proxy/env/*` via the local gateway.
- The Env App UI talks to the agent using **Flowersec RPC/streams** (fs/terminal/monitor domains).
- Codex uses a separate browser-facing gateway contract under `/_redeven_proxy/api/codex/*`; the browser never connects directly to `codex app-server`, and the agent resolves the host `codex` binary on demand instead of mirroring Codex runtime defaults into `config.json`.
- Codex transcript scrolling uses an explicit follow-bottom controller: thread switches and sends re-enter follow mode, late transcript reflow keeps the viewport at the latest output while following, and manual user scroll-away pauses bottom following until the user returns near the bottom or triggers a new explicit bottom intent.
- Flower assistant live rendering strictly separates the settled transcript from the in-flight assistant surface. Persisted transcript rows stay in the virtualized message list, while the active assistant run renders through one dedicated non-virtualized tail surface inside the same scroll container until transcript persistence catches up.
- Flower assistant live output no longer creates synthetic pending transcript messages, transient display rows, or frontend-only message-id adoption. Empty output, hidden-only `thinking`, visible answer text, recovery snapshots, and terminal handoff are inner states of the same mounted live surface.
- Flower assistant live output keeps `thinking` hidden from the default transcript view. Before transcript persistence catches up, visible live answer text may render inline as live content; settled markdown rendering remains a transcript concern once the canonical assistant message lands.
- Active-run snapshots are recovery-only input for the live assistant tail. If the persisted transcript already contains the same assistant `message.id`, the UI must suppress the live tail and rely on the settled transcript row only.
- Run progress is shown on the active live assistant tail through the message ornament contract. The ornament component and avatar shell must stay stably mounted across streaming deltas so the UI does not flash while the phase label updates.
- Transcript-only affordances such as message timestamps and copy actions stay attached to settled transcript messages. The live assistant tail hides those footer actions until the canonical transcript row replaces it.
- Follow-bottom and virtualization operate on transcript rows only. Live-tail growth can still move the scroll height, but it must not mutate the virtual row-height cache or force transcript row remounts during streaming.
- Flower follow-bottom uses motion-aware intents: explicit user bottom intents such as send/return-to-bottom may animate into the latest output, while system restore paths such as thread switch, refresh bootstrap, transcript reset, and baseline recovery must stay instant.
- Detached desktop child windows keep using the same Env App runtime, access gate, and Flowersec protocol path; only the scene rendered inside the window changes.
- Terminal initializes new users with the `Dark` color theme and `Monaco` font while still preserving any saved per-user overrides.
- On mobile, Terminal defaults to the built-in Floe keyboard, keeps taps from auto-triggering the system IME in Floe mode, and offers suggestion rails for recent commands, common commands, scripts, and paths. The default mobile input mode is chosen in Terminal settings as a strict `Floe Keyboard` / `System IME` toggle, while the More menu only exposes temporary show/hide actions when Floe Keyboard mode is active. Floe Keyboard stays as a bottom overlay, the terminal viewport aligns itself to the measured keyboard inset instead of reserving a separate blank spacer above it, and vertical touch drags on the terminal surface are translated into native terminal scrolling on mobile.

## Session bootstrap flow used by the Env App UI

The Env App UI runs on sandbox origins and uses the Redeven session-bootstrap flow:

- Portal issues a one-time `boot_ticket` for Env App startup.
- Sandbox bootstrap exchanges `boot_ticket` for an HttpOnly `env_session` cookie.
- Env App uses `env_session` to mint one-time `entry_ticket` values on demand.
- `entry_ticket` is then redeemed to establish Flowersec sessions.

Security baseline:

- Env App UI never stores long-lived capability credentials in browser storage.
- High-value credentials are HttpOnly cookies scoped to the sandbox origin.
- One-time `entry_ticket` values are exchanged on demand with short TTL.
- If sandbox session context is missing or expired, the browser must return to the Redeven web app for re-issuance.

## Reconnect recovery strategy

Env App reconnect recovery is intentionally split into two layers:

1. **Transport fast retries**
   - Flowersec transport reconnect keeps a small bounded retry budget for short websocket/tunnel blips.
   - This path is optimized for brief network hiccups and quick agent restarts.

2. **App-level waiting loop**
   - If fast retries are exhausted, Env App switches into an explicit waiting state instead of hammering full reconnect attempts.
   - The shell polls environment availability with a single-flight backoff timer and only launches controlled hard reconnect probes.
   - Manual retries and lifecycle nudges (`online`, `focus`, `visibilitychange`) reuse the same coordinator so the UI never spawns parallel reconnect loops.

UI contract:

- `Connecting to agent...`
  - initial session establishment
- `Reconnecting to agent...`
  - transport fast retry or an explicit hard reconnect probe is in flight
- `Waiting for agent...`
  - prolonged outage / restart window after offline-like failures
- `Preparing secure session`
  - transport is back, but the access-gate password/session resume handshake is still running

Design goals:

- keep transient recovery fast,
- bound control-plane pressure during prolonged downtime,
- distinguish agent unavailability from secure-session recovery,
- keep reconnect policy centralized in the Env App shell instead of scattering timers across pages.

## Audit log

There are **two** audit log sources:

1) Redeven service-side session audit log.
   - This is **not** shown in the Env App.
   - It is surfaced in the Redeven web app for environment admins.

2) Agent-local audit log (user operations): recorded and persisted by the agent.
   - Env App reads it via the local gateway API (env admin only):
     - `GET /_redeven_proxy/api/audit/logs?limit=<n>`
   - Storage (JSONL + rotation):
     - `<state_dir>/audit/events.jsonl`
     - `state_dir` is the directory of the agent config file (default: `~/.redeven/`)
   - The log is metadata-only and must not contain secrets (PSK/attach token/AI secrets/file contents).
   - If present, `tunnel_url` is transport routing metadata only. It must not be interpreted as the authorization scope for the session.

## Diagnostics mode

Diagnostics is an infrastructure capability of the local runtime. The floating Debug Console is a frontend-only surface layered on top of that diagnostics stream.

Behavior:

- Agent-side request/direct-session diagnostics are stored separately from audit logs:
  - `<state_dir>/diagnostics/agent-events.jsonl`
- Desktop builds that attach to the same runtime may also write:
  - `<state_dir>/diagnostics/desktop-events.jsonl`
- Local UI and gateway share a single trace header:
  - `X-Redeven-Debug-Trace-ID`
- Local UI and gateway also expose the runtime collector state through:
  - `X-Redeven-Debug-Console-Enabled`
- Agent Settings exposes a dedicated Debug Console section separate from Logging, and the floating console reads data through:
  - `GET /_redeven_proxy/api/debug/diagnostics`
  - `GET /_redeven_proxy/api/debug/diagnostics/export`
  - `GET /_redeven_proxy/api/debug/diagnostics/stream`
- Browser-local rendering telemetry such as FPS, long tasks, layout shifts, and heap usage stays in the Env App shell, starts while the Debug Console is visible, and is merged into the exported debug bundle without being persisted back into the agent state directory.

The diagnostics stream is timing-focused and must remain separate from the audit log because it is intended for troubleshooting performance and startup issues rather than user-operation auditing.

## Codespaces (code-server) management

The Env App UI manages local codespaces via the agent local gateway API:

- `GET /_redeven_proxy/api/spaces`
- `POST /_redeven_proxy/api/spaces`
- `POST /_redeven_proxy/api/spaces/:id/start`
- `POST /_redeven_proxy/api/spaces/:id/stop`
- `DELETE /_redeven_proxy/api/spaces/:id`
- `GET /_redeven_proxy/api/code-runtime/status`
- `POST /_redeven_proxy/api/code-runtime/install`
- `POST /_redeven_proxy/api/code-runtime/uninstall`
- `POST /_redeven_proxy/api/code-runtime/cancel`

When opening a codespace, the Env App mints a one-time ticket for `com.floegence.redeven.code`, then opens:

- `https://cs-<code_space_id>.<region>.<base-sandbox-domain>/_redeven_boot/#redeven=<b64url(init)>`

Notes:

- Codespace/3rd-party app windows never receive `boot_ticket` or `env_session`. They only get one-time `entry_ticket`.
- If a codespace window is refreshed after the hash is cleared, it can request a fresh `entry_ticket` from the opener Env App via `postMessage` handshake.
- Codespaces cards also expose right-click `Ask Flower` and `Open in Terminal` actions. `Ask Flower` stays first to match the broader Env App handoff ordering, while `Open in Terminal` opens a terminal session rooted at `workspace_path`. The `Ask Flower` action sends that same `workspace_path` as directory context so the composer keeps the same folder-oriented prompt copy used by File Browser directory launches.
- Codespaces does **not** auto-install `code-server`. When the runtime is missing or incompatible, Env App shows an explicit install UI and waits for the user to click `Install code-server`.
- Agent Settings also exposes a dedicated `code-server Runtime` management card. It shows the active runtime, the Redeven-managed runtime, explicit install or uninstall actions, the official installer source, the pinned supported version, the managed install location, progress state, and recent management output.
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
