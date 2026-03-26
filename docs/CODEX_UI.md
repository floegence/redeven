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
- The bridge keeps `experimentalApi=false` and targets the stable app-server surface only.
- `thread/start` only forwards explicitly user-supplied fields such as `cwd` and optional `model`; host Codex defaults stay owned by Codex itself.

This keeps the upgrade boundary small:

- Codex CLI and app-server protocol may evolve independently.
- Redeven owns only the gateway adapter and the dedicated UI surface.
- We do not mirror Codex defaults into Redeven config, so new Codex releases do not require a matching front-end settings schema here.

## Host-managed runtime

There is **no** `config.codex` block in `~/.redeven/config.json`.

Redeven resolves `codex` like this:

1. Look up `codex` on the host `PATH`.
2. Start `codex app-server` on demand when a Codex route needs it.
3. Let the local Codex installation keep its own defaults for model, approvals, sandboxing, and other runtime behavior unless the user explicitly overrides a field in the Codex page request itself.

Agent Settings -> Codex is diagnostic-only and currently shows:

- `available`
- `ready`
- `binary_path`
- `agent_home_dir`
- `error`

## Gateway contract

The current browser-facing contract is:

- `GET /_redeven_proxy/api/codex/status`
- `GET /_redeven_proxy/api/codex/threads`
- `POST /_redeven_proxy/api/codex/threads`
- `GET /_redeven_proxy/api/codex/threads/:id`
- `POST /_redeven_proxy/api/codex/threads/:id/archive`
- `POST /_redeven_proxy/api/codex/threads/:id/turns`
- `GET /_redeven_proxy/api/codex/threads/:id/events`
- `POST /_redeven_proxy/api/codex/threads/:id/requests/:request_id/response`

The event stream endpoint is SSE and is used for live transcript / approval updates.

## UI behavior

Current Env App behavior:

- Codex shows as a separate activity-bar item, not inside Flower.
- If host `codex` is unavailable, the entry point still stays visible and the Codex surface shows inline host diagnostics instead of a separate disabled/settings-jump flow.
- The Codex sidebar is a dedicated conversation navigator for Codex threads plus compact host/runtime context; it mirrors the same overall layout rhythm as Flower without reusing Flower-owned UI modules.
- The main Codex page is a Codex-owned chat shell with a compact header, a Flower-aligned transcript lane for user/assistant/evidence rows, inline approvals, a Flower-aligned bottom dock, and a dedicated composer surface.
- The Codex surface uses floe-webapp cards/forms/tags for a consistent Env App look while keeping Codex-specific state and request handling separate.
- The Codex transcript and send bar intentionally mirror Flower's message lane geometry, bubble cadence, and editor chrome through Codex-local components and selectors only; Flower files and selectors are not changed.
- Codex UI structure stays isolated under `src/ui/codex/*`, including its own namespaced `codex.css` layer, so Flower selectors and component contracts do not change when Codex layout evolves.
- New threads can override working directory and model before the first turn.
- Pending approvals and user-input prompts are rendered inside the Codex page and are answered through the Codex gateway contract.
- Transcript rows project user prompts, Codex replies, command evidence, file changes, and reasoning events into chat-style message blocks rather than sharing Flower transcript widgets.
- Env Settings -> Codex does not edit approval policy, sandbox, or model defaults; it only reports host capability and bridge status.

## Permissions

Current permission policy is:

- Opening the Codex activity requires `read + write + execute`.
- Reading Codex status in Agent Settings requires `read`.

This matches the fact that Codex may inspect files, edit files, and run commands on the endpoint runtime.
