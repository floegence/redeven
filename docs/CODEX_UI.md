# Codex (Optional)

Redeven Agent can optionally enable **Codex** as a separate Env App surface backed by the Codex CLI `app-server`.

This integration is intentionally independent from Flower:

- Codex has its own activity-bar entry in Env App.
- Codex has its own Agent Settings section rooted at `config.codex`.
- Codex uses its own gateway namespace: `/_redeven_proxy/api/codex/*`.
- Codex UI state, request handling, and thread lifecycle do not reuse Flower thread/runtime contracts.

## Architecture

High-level design:

- The browser talks only to Redeven Agent gateway routes.
- The Go agent owns the Codex process boundary and spawns `codex app-server` as a child process.
- Transport between Redeven Agent and Codex uses stdio (`codex app-server --listen stdio://`).
- The bridge keeps `experimentalApi=false` and targets the stable app-server surface only.

This keeps the upgrade boundary small:

- Codex CLI and app-server protocol may evolve.
- Redeven UI remains owned in this repository.
- Most upgrade work stays inside the bridge and route adapters instead of forcing a separate upstream UI embed.

## Configuration

Codex settings live under `codex` in the main agent config file (`~/.redeven/config.json` by default).

Example:

```json
{
  "codex": {
    "enabled": true,
    "binary_path": "/usr/local/bin/codex",
    "default_model": "gpt-5.4",
    "approval_policy": "on_request",
    "sandbox_mode": "workspace_write"
  }
}
```

Fields:

- `enabled`
  - Enables the Codex integration surface.
- `binary_path`
  - Optional absolute path to the `codex` binary.
  - If omitted, the agent resolves `codex` from `PATH`.
- `default_model`
  - Optional model override for new Codex threads.
- `approval_policy`
  - One of `untrusted`, `on_failure`, `on_request`, or `never`.
- `sandbox_mode`
  - One of `read_only`, `workspace_write`, or `danger_full_access`.

Notes:

- Codex secrets are not stored in `config.json`.
- Agent Settings updates the bridge live; changes apply to new Codex threads without requiring an agent restart.

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
- Disabled Codex still keeps the entry point visible so users can open the surface and jump directly to Agent Settings → Codex.
- New threads can override working directory and model before the first turn.
- Pending approvals and user-input prompts are rendered inside the Codex page and are answered through the Codex gateway contract.

## Permissions

Current permission policy is:

- Opening the Codex activity requires `read + write + execute`.
- Updating Codex settings requires `admin`.

This matches the fact that Codex may inspect files, edit files, and run commands on the endpoint runtime.
