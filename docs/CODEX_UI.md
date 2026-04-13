# Codex (Optional)

Redeven exposes **Codex** as a separate Env App surface that uses the host machine's `codex` binary directly.

This integration is intentionally independent from Flower:

- Codex has its own activity-bar entry in Env App.
- Codex uses its own gateway namespace: `/_redeven_proxy/api/codex/*`.
- Codex UI state, request handling, and thread lifecycle do not reuse Flower thread/runtime contracts.
- Runtime Settings groups Codex under `AI & Extensions` and only shows read-only host/runtime status there; it does not persist Codex runtime settings.
- The Codex surface uses official OpenAI Codex branding assets and floe-webapp primitives without coupling Codex implementation details back to Flower.

## Architecture

High-level design:

- The browser talks only to Redeven gateway routes.
- The Go runtime owns the Codex process boundary and spawns `codex app-server` from the host's `codex` binary as a child process.
- Transport between Redeven and Codex uses stdio (`codex app-server --listen stdio://`).
- The bridge initializes the app-server with `experimentalApi=true` so it can consume upstream raw response notifications and extended-history controls that are required for refresh-safe transcript projection.
- The bridge keeps a per-thread projected state so browser bootstrap and SSE replay always agree on the same applied event cursor.
- The bridge also keeps per-thread stream journal metadata (`last_applied_seq`, `oldest_retained_seq`, `stream_epoch`, `last_event_at_unix_ms`) so transport continuity can be reasoned about independently from transcript projection.
- The gateway compacts adjacent additive Codex delta notifications (`agentMessage`, reasoning, plan, command output, file diff) into frame-sized SSE batches before flushing them to the browser, so live transcript updates do not turn one upstream token burst into dozens of browser layout passes.
- Best-effort stream pressure is explicit instead of silent:
  - when a subscriber falls behind on best-effort events (`command_output_delta`, `file_change_delta`, `thread_token_usage_updated`), the bridge drops those events for that subscriber only and annotates the next delivered event with `transport.state="lagged"` plus the dropped count;
  - when continuity for a lossless event can no longer be guaranteed, the subscriber is detached and the browser is expected to rebind from the latest projected sequence.
- Replay continuity loss is also explicit:
  - if `after_seq` falls behind the retained journal window, the bridge does not pretend replay succeeded;
  - instead it emits a synthetic `stream_desynced` marker with `transport.reset_required=true`, and the browser reboots the thread detail before resuming live streaming.
- Browser-side stream rebinding now resumes from the latest live-applied session sequence rather than from the older bootstrap baseline, so reselecting a cached thread does not replay already-projected additive deltas.
- Thread bootstrap uses `thread/read(includeTurns=true)` semantics, while live work uses `thread/resume` only when a thread must become active for `turn/start`.
- Read/bootstrap stays recency-neutral: selecting an existing thread may cache transcript/runtime state locally, but it must not fabricate a newer `updated_at` or reorder the sidebar on its own.
- When a freshly started upstream thread has not materialized its first-user-message rollout yet, the bridge falls back from `thread/read(includeTurns=true)` to a summary-only `thread/read(includeTurns=false)` and merges the result with projected state, so the browser does not see the transient upstream error.
- `thread/start` enables `experimentalRawEvents=true` and `persistExtendedHistory=true`, while `thread/resume` also enables `persistExtendedHistory=true`, so refreshes can reconstruct the full Codex-side thread state instead of only the stable transcript subset.
- The bridge normalizes upstream `rawResponseItem/completed` notifications such as `web_search_call` into browser-facing `webSearch` transcript items, which keeps live SSE, refresh bootstrap, and replay behavior consistent.
- The bridge preserves upstream `userMessage.content: UserInput[]` structure for browser rendering, including `textElements`, instead of reducing user-authored turns to markdown-only text.
- `thread/start` only forwards explicitly user-supplied fields such as `cwd` and optional `model`; host Codex defaults stay owned by Codex itself.
- The gateway also aggregates a Codex-only capability snapshot for the browser by combining `model/list`, `config/read`, and `configRequirements/read`.

This keeps the upgrade boundary small:

- Codex CLI and app-server protocol may evolve independently.
- Redeven owns only the gateway adapter and the dedicated UI surface.
- We do not mirror Codex defaults into Redeven config, so new Codex releases do not require a matching front-end settings schema here.

### Browser Controller Ownership

The browser-side Codex UI uses an explicit controller split so thread switching, bootstrap replay, and drafts are not reconciled ad hoc inside one large page component:

- `CodexProvider` is orchestration glue only. It wires resources, user actions, SSE, and view-facing accessors.
- `createCodexThreadController()` owns thread selection/display state, cached sessions, bootstrap status, stale-response guards, and event application into the correct cached thread.
- `createCodexDraftController()` owns per-owner drafts for runtime fields, composer text, and attachments.
- `createCodexFollowupController()` persists only browser-owned `queued` next-turn inputs; it does not own active transcript projection or in-flight same-turn dispatch state.
- `CodexProvider` also keeps an ephemeral per-thread `dispatching` lane for inputs that were accepted locally but have not materialized in the transcript yet.
- `createCodexStreamCoordinator()` owns live stream transport state, reconnect backoff, desync recovery, and the separation between transcript projection and stream health.
- The active thread's foreground lifecycle state is session-owned:
  - detail bootstrap + SSE drive transcript, pending requests, token usage, and stop/send state;
  - thread-list polling stays a summary-only mechanism and must not become a second foreground source of truth.
- Sidebar click feedback is intent-owned: the selected card should paint immediately, while foreground activation is allowed to advance on the next scheduled frame so sidebar feedback does not wait on transcript/bootstrap recomputation.
- A shared follow-bottom scroll controller owns transcript follow/pause state for Codex transcript surfaces; Codex drives it through explicit bottom-intent requests instead of ad hoc per-render `scrollTop = scrollHeight` calls.
- Draft ownership is explicit:
  - `draft:new` for the blank New Chat surface
  - `thread:<id>` for persisted thread-scoped drafts
- The browser distinguishes:
  - `selectedThreadID`: what the user most recently picked
  - `foregroundThreadID`: what the page is currently activating for bootstrap, header/composer ownership, read marking, and active session state
  - `displayedThreadID`: what the transcript is currently allowed to render
- When the user selects a thread that has no ready cached session yet, the main pane enters a loading state instead of continuing to render the previous thread's transcript.
- Thread bootstrap is guarded by a per-selection load token so an older response cannot revive stale content after the user has already switched to another thread.

## Host-managed runtime

There is **no** `config.codex` block in the runtime scope config (for example `~/.redeven/scopes/local/default/config.json`).

Redeven resolves `codex` like this:

1. Look up `codex` on the host `PATH`.
2. Start `codex app-server` on demand when a Codex route needs it by spawning the user's configured shell in `login + interactive` mode and executing `codex app-server --listen stdio://` through that shell.
3. Inherit the runtime process environment as-is and let the user's shell startup files resolve host-specific settings such as `PATH`, `CODEX_HOME`, and related Codex runtime configuration.
4. Let the local Codex installation keep its own defaults for model, approvals, sandboxing, and other runtime behavior unless the user explicitly overrides a field in the Codex page request itself.

Runtime Settings -> `AI & Extensions` -> Codex is diagnostic-only and currently shows:

- `available`
- `ready`
- `binary_path`
- `agent_home_dir`
- `error`

## Gateway contract

The current browser-facing contract is:

- `GET /_redeven_proxy/api/codex/status`
- `GET /_redeven_proxy/api/codex/capabilities`
- `GET /_redeven_proxy/api/codex/threads`
- `POST /_redeven_proxy/api/codex/threads`
- `GET /_redeven_proxy/api/codex/threads/:id`
- `POST /_redeven_proxy/api/codex/threads/:id/read`
- `POST /_redeven_proxy/api/codex/threads/:id/archive`
- `POST /_redeven_proxy/api/codex/threads/:id/unarchive`
- `POST /_redeven_proxy/api/codex/threads/:id/fork`
- `POST /_redeven_proxy/api/codex/threads/:id/interrupt`
- `POST /_redeven_proxy/api/codex/threads/:id/review`
- `POST /_redeven_proxy/api/codex/threads/:id/turns`
- `GET /_redeven_proxy/api/codex/threads/:id/events`
- `POST /_redeven_proxy/api/codex/threads/:id/requests/:request_id/response`

The event stream endpoint is SSE and is used for live transcript / approval updates.

Transport semantics are part of the browser-facing contract:

- `GET /_redeven_proxy/api/codex/threads/:id/events?after_seq=<n>` may return normal projected events, or a synthetic `stream_desynced` event when `<n>` is older than the retained bridge replay window.
- Event payloads may also carry:
  - `stream`
    - `last_applied_seq`
    - `oldest_retained_seq`
    - `stream_epoch`
    - `last_event_at_unix_ms`
  - `transport`
    - `state`
    - `reason`
    - `dropped_events`
    - `reset_required`
- The browser must treat `transport.state="desynced"` / `stream_desynced` as a required bootstrap refresh, not as a recoverable append-only delta.

`GET /_redeven_proxy/api/codex/threads` accepts:

- `limit`
- `archived`

The gateway keeps the `archived` filter for Codex app-server compatibility, but the browser UI uses `thread/list` as an active-thread navigator only and does not expose archived-thread browsing.

`GET /_redeven_proxy/api/codex/threads/:id` returns a projected bootstrap payload with:

- `thread`
- `runtime_config`
- `pending_requests`
- `token_usage`
- `last_applied_seq`
- `stream`
  - `last_applied_seq`
  - `oldest_retained_seq`
  - `stream_epoch`
  - `last_event_at_unix_ms`
- `active_status`
- `active_status_flags`

Codex thread list/detail payloads also include per-thread `read_status` on `thread` objects:

- `is_unread`
- `snapshot`
  - `updated_at_unix_s`
  - `activity_signature`
- `read_state`
  - `last_read_updated_at_unix_s`
  - `last_seen_activity_signature`

`POST /_redeven_proxy/api/codex/threads/:id/read` accepts the browser-visible `snapshot`, validates that it does not move beyond the current backend thread state, and advances the per-user read watermark monotonically. The runtime persists that watermark by `endpoint_id + user_public_id + surface + thread_id`, so unread state survives environment switches and refreshes instead of living in browser-local storage.

`last_applied_seq` means the returned bootstrap has already applied all bridge-projected events up to that sequence number. The browser must resume SSE from that exact sequence so refreshes do not lose live work state.

`stream.oldest_retained_seq` means the oldest event sequence that is still available for replay through the bridge journal. If the browser attempts to resume before that window, the event stream responds with `stream_desynced` and the browser must refresh thread detail instead of trusting append-only replay.

`POST /_redeven_proxy/api/codex/threads` returns the normalized thread detail bootstrap, including `runtime_config` with the resolved app-server values for:

- `model`
- `model_provider`
- `cwd`
- `approval_policy`
- `approvals_reviewer`
- `sandbox_mode`
- `reasoning_effort`

`POST /_redeven_proxy/api/codex/threads/:id/turns` also accepts Codex-local runtime fields for bridge/browser compatibility:

- `inputs`
- `cwd`
- `model`
- `effort`
- `approval_policy`
- `sandbox_mode`
- `approvals_reviewer`

The browser UI currently uses `cwd` only while creating a brand-new thread and issuing its first turn. Once a thread exists, the Codex page renders the working directory as locked and does not send per-turn `cwd` overrides.

When the target thread is not currently live-loaded on the bridge connection, the bridge resumes it before forwarding `turn/start`.

`GET /_redeven_proxy/api/codex/capabilities` now also returns `operations`, a browser-facing list of lifecycle/control actions currently exposed by the Redeven Codex surface. Phase 1 operations are:

- `thread_archive`
- `thread_fork`
- `turn_interrupt`
- `review_start`

`POST /_redeven_proxy/api/codex/threads/:id/fork` returns the normalized thread detail bootstrap for the newly forked thread.

`POST /_redeven_proxy/api/codex/threads/:id/review` currently supports the Phase 1 target `uncommitted_changes` only and starts the review inline on the current thread.

`POST /_redeven_proxy/api/codex/threads/:id/interrupt` requires `turn_id`.

## UI behavior

Current Env App behavior:

- Codex shows as a separate activity-bar item, not inside Flower.
- Desktop navigation between Codex/Flower and full-screen Env App pages suppresses the shell sidebar width transition for that one visibility change, but explicit re-click collapse/reopen on the active Codex/Flower activity item still uses the shared smooth animation; mobile behavior is unchanged.
- If host `codex` is unavailable, the entry point still stays visible and the Codex surface shows inline host diagnostics instead of a separate disabled/settings-jump flow.
- When host `codex` is unavailable, Codex keeps the page-level diagnostics visible but disables host-backed actions such as `New Chat`, archive, send, attachments, and working-directory editing rather than leaving a half-interactive shell.
- The Codex sidebar is a dedicated conversation navigator for Codex threads plus compact host/runtime context; it mirrors the same overall layout rhythm as Flower without reusing Flower-owned UI modules.
- The main Codex page is a Codex-owned chat shell with a single-row compact header, a Flower-aligned transcript lane for user/assistant/evidence rows, inline approvals, a soft-edged bottom dock, and a dedicated composer surface.
- The Codex surface uses floe-webapp cards/forms/tags for a consistent Env App look while keeping Codex-specific state and request handling separate.
- The Codex transcript and send bar intentionally mirror Flower's message lane geometry, bubble cadence, and editor chrome through Codex-local components and selectors only; Flower files and selectors are not changed.
- Codex UI structure stays isolated under `src/ui/codex/*`, including its own namespaced `codex.css` layer, so Flower selectors and component contracts do not change when Codex layout evolves.
- Codex composer textarea autosizing is also isolated under `src/ui/codex/*`: `CodexComposerShell` delegates measurement to `createCodexComposerAutosizeController`, which lazy-loads `@chenglou/pretext` only for the Codex composer and falls back to DOM `scrollHeight` measurement when typography or runtime conditions are unsafe.
- Codex visual styling uses a Codex-local semantic surface token family on `.codex-page-shell` (`--codex-surface-*`, `--codex-border-*`, `--codex-text-secondary`) so page, dock, transcript, reasoning, and markdown surfaces share one flat presentation contract instead of per-selector decorative gradients.
- Codex intentionally excludes decorative `linear-gradient(...)` / `radial-gradient(...)` treatments from its page shell; when Codex needs to neutralize shared chat styling such as user bubbles or the send button, it does so through `.codex-page-shell .chat-*` overrides instead of mutating Flower-owned selectors.
- The sidebar keeps stable thread row height in both selected and unselected states; Codex-only active chrome never inserts extra row content that would shift Flower-like list rhythm.
- The sidebar keeps stable thread row identity as well: unchanged list summaries reuse their previous browser objects so running indicators remain mounted instead of replaying animation on every refresh.
- The sidebar treats archive as a one-way disappearance from the browser conversation list, matching Codex's default active-thread navigation model rather than exposing a dedicated archived browser.
- Sidebar thread order changes only for real thread activity such as new-thread creation, user turn sends, or live lifecycle updates. Clicking an existing thread to read/bootstrap it must not reorder the list by itself.
- Active-thread foreground work must not trigger list polling. Polling is reserved for background running threads whose lifecycle is not already covered by the selected thread's detail bootstrap + SSE stream.
- Codex unread state is server-backed. Opening a thread marks the current browser-visible snapshot as read through the gateway instead of writing unread state to desktop/local browser storage.
- Live stream transport is browser-managed instead of fire-and-forget:
  - transient disconnects enter a reconnecting state with automatic rebind from the latest applied sequence;
  - lagged best-effort delivery stays visible as transport state without mutating transcript state;
  - replay-window loss enters an explicit desynced state and forces a detail bootstrap before live re-attach.
- Starting a brand-new thread creates an optimistic sidebar row immediately, so the newly selected thread stays visible before `thread/list` catches up.
- Switching from thread A to thread B clears stale thread A transcript content if thread B is still bootstrapping; the page shows an explicit loading state for the selected thread instead.
- Switching to an existing Codex thread explicitly re-enters follow-bottom mode, so the transcript converges to the newest output instead of staying at a stale mid-thread scroll offset.
- Per-thread drafts are preserved independently, so composer text, attachments, and runtime overrides no longer leak between existing threads and the New Chat surface.
- Browser-owned pending input now has one strict rendering rule:
  - editable content lives in the composer;
  - accepted-but-not-materialized content lives in the pending rail above the composer;
  - transcript content appears only after Codex materializes it.
- The pending rail separates two browser-owned states:
  - `dispatching`: accepted locally and currently being sent or waiting for transcript materialization;
  - `queued`: intentionally deferred to the next turn, persisted in browser storage, editable, removable, and reorderable.
- Queued cards stay action-oriented rather than diagnostic:
  - click the card body to restore/edit;
  - use `Guide` to apply a queued prompt to the active turn when same-turn steering is available;
  - remove and move-earlier / move-later controls stay on the card edge.
- The composer keeps the most useful Codex controls directly below the input instead of in a noisy chip rail:
  - working directory
  - image attachments
  - model
  - reasoning effort
  - approval policy
  - sandbox mode
- The composer treats the prompt as the only primary surface and groups draft context on the left (`attachments`, `working directory`, draft objects) while keeping execution strategy on the right (`model`, `reasoning effort`, `approval policy`, `sandbox mode`).
- Selected runtime controls use value-first presentation instead of repeating field labels at rest:
  - `model` and `reasoning effort` collapse to lighter value triggers;
  - `approval policy` and `sandbox mode` keep compact tag-like strategy pills;
  - the working directory keeps the stronger path-chip treatment.
- Draft mentions and attachments render as a lower-priority draft-object lane beneath the control row instead of sharing the same visual weight as runtime controls.
- Generic onboarding copy such as `@` / `/` / image hints is conditional; it only appears when the composer is still empty or when capability/state feedback is genuinely needed.
- Composer action semantics are state-driven but stay inside one icon-only composer action slot:
  - idle or new thread: the button sends immediately;
  - active run with an empty draft: that same button becomes `Stop`;
  - active run with queueable draft content: that same button queues the prompt into the rail above the composer;
  - same-turn steering is exposed from queued items through `Guide`, not through a second composer button.
- Idle sends still use optimistic transcript user rows, but queued `Guide` dispatches and queue auto-send do not; they stay in the pending rail until Codex materializes the real transcript item.
- The transcript-to-composer boundary is intentionally soft: the Codex send bar should read as floating over the transcript tail rather than as a second hard-split footer panel.
- The Codex transcript now also exposes the same floating `Browse files` FAB pattern used by Flower, seeded from the resolved Codex working directory and routed through the shared Env App file-browser surface instead of a Codex-local browser implementation.
- Image attachments currently use browser-side data URLs and are sent as Codex `image` user inputs; this is intentionally limited to image files only.
- New threads can choose working directory, model, approval policy, sandbox mode, and reasoning effort before the first turn.
- The working-directory picker uses the shared floe-webapp async path-resolution contract plus an Env App directory data source that hydrates ancestor folders on demand, so deep initial cwd values, typed path entry, breadcrumb jumps, and tree reselection all resolve against the same lazy-loaded tree state.
- Once a thread exists, the Codex browser UI locks the working directory to the persisted thread cwd and no longer exposes a working-directory editor or per-turn cwd override flow.
- The transcript FAB follows the same resolved working-directory precedence as the rest of the Codex page (`workingDirDraft -> runtime_config.cwd -> thread.cwd -> capabilities.effective_config.cwd -> agent_home_dir`), so the browser always opens at the directory Codex itself currently considers active.
- The Codex transcript FAB is persistently visible through a Codex-local wrapper in `src/ui/codex/*` rather than by changing Flower's shared FAB behavior. Its floating geometry is owned by a Codex-local transcript overlay track that shares the transcript lane width contract, so resizing the window or changing adjacent shell widths keeps the FAB aligned to the visible Codex message lane instead of to the full viewport edge. When the working directory is temporarily empty, Codex falls back to `agent_home_dir` for browser opening before degrading to a visible disabled button, and the FAB stays visible even while the shared browser surface is already open or host Codex itself is unavailable.
- Browser-surface ownership remains shared rather than Codex-local:
  - Codex owns only the directory seed and transcript mount point;
  - Env App shell still owns floating-window persistence, desktop browser presentation policy, and `RemoteFileBrowser` rendering through `FileBrowserSurfaceContext`, `FileBrowserSurfaceHost`, and `openFileBrowserSurface()`.
- Archiving a thread hides it from the browser conversation list after the active-thread list refreshes.
- Later turns may still adjust model, reasoning effort, approval policy, and sandbox mode through the Codex composer controls.
- Pending approvals and user-input prompts are rendered inside the Codex page and are answered through the Codex gateway contract.
- The thread header now exposes capability-gated lifecycle actions:
  - archive
  - fork
  - review current workspace changes
  - stop the active turn when the current thread has an in-progress turn
- Turn interrupt affordances derive from the same active-run model as the transcript working indicator, and the browser keeps `thread.turns` aligned with `turn_started` / `turn_completed` events so stop/send transitions do not depend on stale bootstrap metadata.
- Transcript rows project user prompts, Codex replies, command executions, file changes, and reasoning events into chat-style message blocks rather than sharing Flower transcript widgets, and redundant role badges / prompt ideas / refresh chrome are intentionally removed.
- File-change transcript rows keep their payload adaptation in `src/ui/codex/*`, so raw Codex `changes[].diff` values can still be normalized into valid git-patch evidence for new files and partial diffs, but the rendered patch surface now reuses the shared Git patch viewer instead of a second Codex-local diff viewport theme.
- The transcript root now owns an explicit full-height Codex shell that resolves one render mode before children are laid out:
  - `empty`: center the welcome or diagnostic hero against the real transcript viewport;
  - `loading`: reuse the same viewport shell for selected-thread hydration;
  - `feed`: render transcript rows and pending assistant lanes.
- Reasoning and plan expansion state is transcript-owned and keyed by logical item id: rows now start collapsed by default, and later stream/completion updates preserve the user's explicit expand/collapse choice instead of resetting it.
- Command execution rows render the collapsible shell block directly in the transcript lane instead of nesting it inside an extra evidence-card header chrome.
- User-message rendering is intentionally separate from assistant/evidence markdown rendering:
  - assistant/evidence items still use the markdown renderer;
  - `userMessage` items render from structured `inputs[]` in original order;
  - `text` user inputs display as raw text with preserved line breaks and no markdown/HTML interpretation;
  - `image` user inputs render inline thumbnails;
  - `localImage` and `skill` user inputs open the existing file-preview floating window when clicked;
  - `mention` user inputs render as semantic chips and do not route into file preview.
- Codex markdown keeps the existing renderer DOM contract for standard links and local file references, preserves file-reference labels that include embedded line anchors such as `CODEX_UI.md#L121`, and now relies on the shared floe-webapp file-reference chip styling instead of a Codex-only outline treatment.
- Before the first real assistant transcript message lands, the transcript renders a single pending assistant lane that owns the Codex avatar, shows a pre-output streaming cursor bubble, and places the compact working indicator directly underneath in the same lane.
- Once a real assistant message starts streaming, that pending lane disappears; the real assistant message takes over avatar ownership, keeps the same first-line lead alignment against the avatar center, and the remaining working indicator stays avatar-free.
- Codex transcript scrolling now has two explicit modes:
  - `following`: thread switch, bootstrap, and send intents keep the viewport pinned to the latest output, including later markdown/layout reflow;
  - `paused`: when the user scrolls away from the bottom, later transcript reflow preserves the visible anchor row instead of yanking the viewport back to the bottom.
- Follow-bottom intent handling is Codex-local. `CodexProvider` emits explicit bottom-intent requests, and `createFollowBottomController()` resolves them without changing Flower-owned pages or shared Flower transcript selectors.
- System restore intents such as `bootstrap` and `thread_switch` stay instant so thread hydration and late layout reconciliation converge deterministically without introducing extra motion.
- Explicit manual “return to bottom” requests use smooth convergence when reduced motion is not requested, but `send` re-enters follow-bottom with an instant pin so heavy live Codex output does not spend the whole turn chasing a moving animated target.
- The controller now targets the real bottom scroll position (`scrollHeight - clientHeight`) instead of the raw content height, which keeps bottom-follow math correct for both instant and animated follow paths.
- Empty and loading heroes depend on that Codex-owned transcript shell rather than on ad-hoc top spacing, so viewport centering stays stable without patching Flower-owned selectors.
- Empty reasoning shells from upstream placeholder events are suppressed until they contain summary or body content.
- Transcript feed rows are keyed by semantic transcript item id, not by transient `CodexTranscriptItem` object identity. That keeps each live row mounted across append-only updates so `MarkdownBlock` can retain its committed streaming snapshot instead of bouncing between raw append-only text and rebuilt markdown HTML.
- Web search evidence renders normalized action details such as search queries and opened page URLs instead of falling back to generic `No content.` placeholders.
- The header renders projected token/context usage from official `thread/tokenUsage/updated` notifications, following the same “context left / used tokens” semantics exposed by the upstream Codex app-server.
- Codex icon rendering prefers a bundled official artwork asset, but it now also keeps an inline fallback glyph so embedded builds never surface the browser's broken-image placeholder if artwork loading fails.
- Env Settings -> `AI & Extensions` -> Codex does not edit approval policy, sandbox, or model defaults; it only reports host capability and bridge status.

## Permissions

Current permission policy is:

- Opening the Codex activity requires `read + write + execute`.
- Reading Codex status in Runtime Settings requires `read`.

This matches the fact that Codex may inspect files, edit files, and run commands on the endpoint runtime.
