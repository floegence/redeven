# Codex (Optional)

Redeven Agent exposes **Codex** as a separate Env App surface that uses the host machine's `codex` binary directly.

This integration is intentionally independent from Flower:

- Codex has its own activity-bar entry in Env App.
- Codex uses its own gateway namespace: `/_redeven_proxy/api/codex/*`.
- Codex UI state, request handling, and thread lifecycle do not reuse Flower thread/runtime contracts.
- Agent Settings only shows read-only Codex host/runtime status; it does not persist Codex runtime settings.
- The Codex surface uses official OpenAI Codex branding assets and floe-webapp primitives without coupling Codex implementation details back to Flower.

## Architecture

High-level design:

- The browser talks only to Redeven Agent gateway routes.
- The Go agent owns the Codex process boundary and spawns `codex app-server` from the host's `codex` binary as a child process.
- Transport between Redeven Agent and Codex uses stdio (`codex app-server --listen stdio://`).
- The bridge initializes the app-server with `experimentalApi=true` so it can consume upstream raw response notifications and extended-history controls that are required for refresh-safe transcript projection.
- The bridge keeps a per-thread projected state so browser bootstrap and SSE replay always agree on the same applied event cursor.
- Thread bootstrap uses `thread/read(includeTurns=true)` semantics, while live work uses `thread/resume` only when a thread must become active for `turn/start`.
- `thread/start` enables `experimentalRawEvents=true` and `persistExtendedHistory=true`, while `thread/resume` also enables `persistExtendedHistory=true`, so refreshes can reconstruct the full Codex-side thread state instead of only the stable transcript subset.
- The bridge normalizes upstream `rawResponseItem/completed` notifications such as `web_search_call` into browser-facing `webSearch` transcript items, which keeps live SSE, refresh bootstrap, and replay behavior consistent.
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
- Draft ownership is explicit:
  - `draft:new` for the blank New Chat surface
  - `thread:<id>` for persisted thread-scoped drafts
- The browser distinguishes:
  - `selectedThreadID`: what the user most recently picked
  - `displayedThreadID`: what the transcript is currently allowed to render
- When the user selects a thread that has no ready cached session yet, the main pane enters a loading state instead of continuing to render the previous thread's transcript.
- Thread bootstrap is guarded by a per-selection load token so an older response cannot revive stale content after the user has already switched to another thread.

## Host-managed runtime

There is **no** `config.codex` block in `~/.redeven/config.json`.

Redeven resolves `codex` like this:

1. Look up `codex` on the host `PATH`.
2. Start `codex app-server` on demand when a Codex route needs it by spawning the user's configured shell in `login + interactive` mode and executing `codex app-server --listen stdio://` through that shell.
3. Inherit the agent process environment as-is and let the user's shell startup files resolve host-specific settings such as `PATH`, `CODEX_HOME`, and related Codex runtime configuration.
4. Let the local Codex installation keep its own defaults for model, approvals, sandboxing, and other runtime behavior unless the user explicitly overrides a field in the Codex page request itself.

Agent Settings -> Codex is diagnostic-only and currently shows:

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
- `POST /_redeven_proxy/api/codex/threads/:id/archive`
- `POST /_redeven_proxy/api/codex/threads/:id/turns`
- `GET /_redeven_proxy/api/codex/threads/:id/events`
- `POST /_redeven_proxy/api/codex/threads/:id/requests/:request_id/response`

The event stream endpoint is SSE and is used for live transcript / approval updates.

`GET /_redeven_proxy/api/codex/threads/:id` returns a projected bootstrap payload with:

- `thread`
- `runtime_config`
- `pending_requests`
- `token_usage`
- `last_applied_seq`
- `active_status`
- `active_status_flags`

`last_applied_seq` means the returned bootstrap has already applied all bridge-projected events up to that sequence number. The browser must resume SSE from that exact sequence so refreshes do not lose live work state.

`POST /_redeven_proxy/api/codex/threads` returns the normalized thread detail bootstrap, including `runtime_config` with the resolved app-server values for:

- `model`
- `model_provider`
- `cwd`
- `approval_policy`
- `approvals_reviewer`
- `sandbox_mode`
- `reasoning_effort`

`POST /_redeven_proxy/api/codex/threads/:id/turns` also accepts Codex-local sticky overrides:

- `inputs`
- `cwd`
- `model`
- `effort`
- `approval_policy`
- `sandbox_mode`
- `approvals_reviewer`

When the target thread is not currently live-loaded on the bridge connection, the bridge resumes it before forwarding `turn/start`.

## UI behavior

Current Env App behavior:

- Codex shows as a separate activity-bar item, not inside Flower.
- If host `codex` is unavailable, the entry point still stays visible and the Codex surface shows inline host diagnostics instead of a separate disabled/settings-jump flow.
- The Codex sidebar is a dedicated conversation navigator for Codex threads plus compact host/runtime context; it mirrors the same overall layout rhythm as Flower without reusing Flower-owned UI modules.
- The main Codex page is a Codex-owned chat shell with a single-row compact header, a Flower-aligned transcript lane for user/assistant/evidence rows, inline approvals, a Flower-aligned bottom dock, and a dedicated composer surface.
- The Codex surface uses floe-webapp cards/forms/tags for a consistent Env App look while keeping Codex-specific state and request handling separate.
- The Codex transcript and send bar intentionally mirror Flower's message lane geometry, bubble cadence, and editor chrome through Codex-local components and selectors only; Flower files and selectors are not changed.
- Codex UI structure stays isolated under `src/ui/codex/*`, including its own namespaced `codex.css` layer, so Flower selectors and component contracts do not change when Codex layout evolves.
- The sidebar keeps stable thread row height in both selected and unselected states; Codex-only active chrome never inserts extra row content that would shift Flower-like list rhythm.
- Starting a brand-new thread creates an optimistic sidebar row immediately, so the newly selected thread stays visible before `thread/list` catches up.
- Switching from thread A to thread B clears stale thread A transcript content if thread B is still bootstrapping; the page shows an explicit loading state for the selected thread instead.
- Per-thread drafts are preserved independently, so composer text, attachments, and runtime overrides no longer leak between existing threads and the New Chat surface.
- The composer keeps the most useful Codex controls directly below the input instead of in a noisy chip rail:
  - working directory
  - image attachments
  - model
  - reasoning effort
  - approval policy
  - sandbox mode
- Image attachments currently use browser-side data URLs and are sent as Codex `image` user inputs; this is intentionally limited to image files only.
- New threads can override working directory, model, approval policy, and sandbox before the first turn, and later turns can keep those settings sticky through explicit `turn/start` overrides.
- Pending approvals and user-input prompts are rendered inside the Codex page and are answered through the Codex gateway contract.
- Transcript rows project user prompts, Codex replies, command evidence, file changes, and reasoning events into chat-style message blocks rather than sharing Flower transcript widgets, and redundant role badges / prompt ideas / refresh chrome are intentionally removed.
- The live working row uses a Codex-local Flower-like dots indicator with a streaming cursor, and it intentionally stays avatar-free so assistant identity is anchored to real assistant messages instead of floating with the tail state.
- Empty reasoning shells from upstream placeholder events are suppressed until they contain summary or body content.
- Web search evidence renders normalized action details such as search queries and opened page URLs instead of falling back to generic `No content.` placeholders.
- The header renders projected token/context usage from official `thread/tokenUsage/updated` notifications, following the same “context left / used tokens” semantics exposed by the upstream Codex app-server.
- Env Settings -> Codex does not edit approval policy, sandbox, or model defaults; it only reports host capability and bridge status.

## Permissions

Current permission policy is:

- Opening the Codex activity requires `read + write + execute`.
- Reading Codex status in Agent Settings requires `read`.

This matches the fact that Codex may inspect files, edit files, and run commands on the endpoint runtime.
