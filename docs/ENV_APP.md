# Env App (env details UI over Flowersec E2EE)

This document describes the **Env App** implementation in the Redeven agent.

Key points:

- The Env App UI is **agent-bundled** (built + embedded into the agent binary).
- The browser accesses it over a **Flowersec E2EE proxy** (runtime mode).
- Env details features live here (Deck/Terminal/Monitor/File Browser/Codespaces/Ports/Flower/Codex).
- Codex is a separate optional AI runtime with its own activity-bar entry, settings section, and gateway namespace; it is not implemented as a Flower mode, provider, or sub-page.
- Flower chat keeps model-picking scope explicit: the draft chat picker updates the default model for future new chats, active unlocked threads edit only their own thread model, and locked threads show a read-only model badge instead of a misleading editable control.
- Flower thread history keeps the chat `title` separate from the latest `last_message_preview` snippet: untitled chats render as `New chat` until the agent later writes a generated title, while the preview line continues to reflect the newest visible message text.
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
- Git browser cards now follow the same helper-action ordering where it makes semantic sense: `Changes` exposes `Ask Flower`, `Open in Terminal`, and `Browse Files`; `Branches` exposes directory handoffs only when the selected branch resolves to a checked-out worktree; `Graph` exposes only commit-scoped `Ask Flower` because commit history is not a live filesystem directory.
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
- For the current branch, branch status uses the active repository root.
- For a linked local branch, branch status uses the branch `worktreePath`.
- For remote branches or local branches without a checked-out worktree, branch status stays unavailable and the UI points users to `Compare` or to opening the branch in a worktree.
- Git browse `Ask Flower` entry points use Git-authored snapshot context instead of pretending commit or workspace summaries are file-browser selections, so Flower receives a clean summary of the selected workspace section or commit metadata/file list.
- Git diff dialogs keep the embedded `Patch` preview as the default fast path, and now also expose an on-demand `Full Context` mode that re-fetches a single selected file diff with unchanged lines included for broader review context.
- Git branch deletion keeps `safe delete` as the default path, but when an unmerged local branch cannot be safely deleted the review dialog can escalate into an exact branch-name-confirmed `force delete`; linked worktrees are force-removed together with their pending changes, while inaccessible linked worktrees remain blocked.

This keeps worktree status consistent even when the user opens `Branches` first without visiting `Changes`.

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
- Codex uses a separate browser-facing gateway contract under `/_redeven_proxy/api/codex/*`; the browser never connects directly to `codex app-server`.
- Flower assistant live rendering uses one assistant answer surface: the message list. Persisted transcript rows, active-run snapshots, and realtime stream events reconcile into a single inline assistant-turn projection instead of separate transcript and footer answer surfaces.
- Flower assistant live output keeps `thinking` hidden from the default transcript view. Before transcript persistence catches up, visible live answer text may render inline as plain text; settled markdown rendering remains a transcript concern once the canonical assistant message lands.
- Active-run snapshots are recovery-only input for the inline live assistant projection. If the persisted transcript already contains the same assistant `message.id`, the UI must suppress the live projection and rely on the settled transcript row only.
- Run progress is shown on the active inline assistant row through the message ornament contract. The footer is status-only and appears only when a run is pending without any visible live assistant row, so it never renders duplicate assistant answer content.
- Transcript-only affordances such as message timestamps and copy actions stay attached to settled transcript messages. Active streaming assistant rows hide those footer actions until the canonical transcript row replaces the live projection.
- Follow-bottom and virtualization operate on one evolving assistant row identity rather than competing answer surfaces, reducing remeasurement churn and eliminating transcript/footer divergence during streaming.
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

## Diagnostics mode

Diagnostics mode is enabled implicitly when the agent config uses:

- `logging.log_level = "debug"`

Behavior:

- Agent-side request/direct-session diagnostics are stored separately from audit logs:
  - `<state_dir>/diagnostics/agent-events.jsonl`
- Desktop builds that attach to the same runtime may also write:
  - `<state_dir>/diagnostics/desktop-events.jsonl`
- Local UI and gateway share a single trace header:
  - `X-Redeven-Debug-Trace-ID`
- Agent Settings exposes a Diagnostics panel under Logging and reads data through:
  - `GET /_redeven_proxy/api/debug/diagnostics`
  - `GET /_redeven_proxy/api/debug/diagnostics/export`

The diagnostics stream is timing-focused and must remain separate from the audit log because it is intended for troubleshooting performance and startup issues rather than user-operation auditing.

## Codespaces (code-server) management

The Env App UI manages local codespaces via the agent local gateway API:

- `GET /_redeven_proxy/api/spaces`
- `POST /_redeven_proxy/api/spaces`
- `POST /_redeven_proxy/api/spaces/:id/start`
- `POST /_redeven_proxy/api/spaces/:id/stop`
- `DELETE /_redeven_proxy/api/spaces/:id`

When opening a codespace, the Env App mints a one-time ticket for `com.floegence.redeven.code`, then opens:

- `https://cs-<code_space_id>.<region>.<base-sandbox-domain>/_redeven_boot/#redeven=<b64url(init)>`

Notes:

- Codespace/3rd-party app windows never receive `boot_ticket` or `env_session`. They only get one-time `entry_ticket`.
- If a codespace window is refreshed after the hash is cleared, it can request a fresh `entry_ticket` from the opener Env App via `postMessage` handshake.
- Codespaces cards also expose right-click `Ask Flower` and `Open in Terminal` actions. `Ask Flower` stays first to match the broader Env App handoff ordering, while `Open in Terminal` opens a terminal session rooted at `workspace_path`. The `Ask Flower` action sends that same `workspace_path` as directory context so the composer keeps the same folder-oriented prompt copy used by File Browser directory launches.

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
