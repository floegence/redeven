# Codex (Optional)

Redeven exposes **Codex** as a separate Env App surface that uses the host's `codex` binary directly.

This integration is intentionally independent from Flower:

- Codex has its own activity-bar entry in Env App.
- Codex uses its own gateway namespace: `/_redeven_proxy/api/codex/*`.
- Codex UI state, request handling, and thread lifecycle do not reuse Flower thread/runtime contracts.
- Runtime Settings groups Codex under `AI & Extensions` and only shows read-only host/runtime status there; it does not persist Codex runtime settings.
- The Codex surface uses official OpenAI Codex branding assets and floe-webapp primitives without coupling Codex implementation details back to Flower.
- Cross-surface `Ask Codex` entry points should be modeled as Context Action Protocol actions (`assistant.ask.codex`) rather than as Flower modes or Flower providers. See [`AGENT_SKILLS.md`](AGENT_SKILLS.md).

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

There is **no** `config.codex` block in the runtime Local Environment config (for example `~/.redeven/local-environment/config.json`).

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
- `POST /_redeven_proxy/api/codex/threads/:id/turns/steer`
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

`POST /_redeven_proxy/api/codex/threads/:id/turns/steer` accepts queued guidance for an active turn:

- `expected_turn_id`
- `inputs`

`GET /_redeven_proxy/api/codex/capabilities` now also returns `operations`, a browser-facing list of lifecycle/control actions currently exposed by the Redeven Codex surface. Phase 1 operations are:

- `thread_archive`
- `thread_fork`
- `turn_steer`
- `turn_interrupt`
- `review_start`

`POST /_redeven_proxy/api/codex/threads/:id/fork` returns the normalized thread detail bootstrap for the newly forked thread.

`POST /_redeven_proxy/api/codex/threads/:id/review` currently supports the Phase 1 target `uncommitted_changes` only and starts the review inline on the current thread.

`POST /_redeven_proxy/api/codex/threads/:id/interrupt` requires `turn_id`.

## UI behavior

Current Env App behavior:

- Codex shows as a separate activity-bar item, not inside Flower.
- If host `codex` is unavailable, the entry point still stays visible and the Codex surface shows inline host diagnostics instead of a separate disabled/settings-jump flow.
- When host `codex` is unavailable, Codex keeps the page-level diagnostics visible but disables host-backed actions such as `New Chat`, archive, send, attachments, and working-directory editing rather than leaving a half-interactive shell.
- The Codex sidebar is a dedicated conversation navigator for Codex threads plus compact host/runtime context; it mirrors the same overall layout rhythm as Flower without reusing Flower-owned UI modules.
- The main Codex page is a Codex-owned chat shell with a compact header, dedicated sidebar, transcript lane, inline approvals, bottom composer, and host diagnostics.
- Codex UI structure stays isolated under `src/ui/codex/*`, including Codex-local controller code and namespaced styling. Flower files and selectors should not change when Codex layout evolves.
- Thread selection is explicit: `selectedThreadID` updates for immediate sidebar feedback, while foreground/bootstrap state controls which transcript may render.
- Thread list polling stays summary-only. Active thread state comes from detail bootstrap plus SSE.
- Codex unread state is server-backed through gateway `read_status`, not desktop/local browser storage.
- Live stream transport is browser-managed: transient disconnects rebind from the latest applied sequence, lagged best-effort delivery is surfaced as transport state, and replay-window loss forces a detail bootstrap.
- Per-thread drafts are isolated. Editable draft content lives in the composer; accepted-but-not-yet-materialized input lives in the pending rail; transcript content appears only after Codex materializes it.
- New threads can set working directory, model, approval policy, sandbox mode, and reasoning effort before the first turn. Existing threads keep their persisted working directory locked in the browser UI.
- Composer controls include working directory, image attachments, model, reasoning effort, approval policy, and sandbox mode. Image attachments are limited to image files and are sent as Codex `image` user inputs.
- Thread lifecycle actions are capability-gated: archive, fork, review current workspace changes, and interrupt the active turn.
- The transcript projects user prompts, Codex replies, command executions, file changes, reasoning, web search evidence, and pending approvals through Codex-local renderers.
- User-authored text renders as raw text with preserved line breaks; assistant/evidence content uses markdown rendering; file-change rows reuse the shared Git patch viewer.
- Codex transcript scrolling has `following` and `paused` modes. Thread switch/bootstrap/send re-enter follow mode, while manual scroll-away preserves the visible anchor until the user returns near the bottom.
- The transcript `Browse files` affordance seeds the shared Env App file-browser surface from the resolved Codex working directory; Codex does not own a separate file-browser implementation.
- Env Settings -> `AI & Extensions` -> Codex reports host capability and bridge status only. It does not edit approval policy, sandbox, or model defaults.

## Permissions

Current permission policy is:

- Opening the Codex activity requires `read + write + execute`.
- Reading Codex status in Runtime Settings requires `read`.

This matches the fact that Codex may inspect files, edit files, and run commands on the endpoint runtime.
