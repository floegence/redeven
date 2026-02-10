# AI Agent (Optional)

Redeven Agent can optionally enable an **AI Agent** feature inside the Env App UI.

High-level design:

- The browser UI calls the agent via the existing `/_redeven_proxy/api/ai/*` gateway routes (still over Flowersec E2EE proxy).
- The **Go agent is the security boundary** and executes tools (filesystem, terminal) after validating authoritative `session_meta`.
- A bundled **TypeScript sidecar** process (Node.js) runs the LLM orchestration (tool calling / multi-step loop) via the Vercel AI SDK.

## Requirements

- AI sidecar needs Node.js `>= 20`.
- `install.sh` automatically checks host `node` and bootstraps a static runtime from `https://nodejs.org/dist/latest-v20.x` when host Node is missing or too old.
- If Node bootstrap fails, agent installation still succeeds, but AI sidecar features are degraded until a compatible Node runtime is available.
- Provider API keys are stored locally in a separate secrets file (never store secrets in `config.json`).

Runtime node resolution order:

1. `REDEVEN_AI_NODE_BIN` (when set and compatible)
2. `node` from `PATH` (when compatible)
3. static runtime under `~/.redeven/runtime/node/current/bin/node`

Installer bootstrap controls:

- `REDEVEN_NODE_DIST_BASE_URL` (override the Node distribution base URL)
- `REDEVEN_SKIP_AI_NODE_BOOTSTRAP=1` (skip static Node bootstrap)

## Configuration

Enable the feature by adding an `ai` section to the agent config file (default: `~/.redeven/config.json`).

Notes:

- Providers own their model list: `ai.providers[].models[]` is the allow-list shown in the Chat UI.
- Exactly one `providers[].models[].is_default` must be true (default for new chats).
- The wire model id remains `<provider_id>/<model_name>` (used by the sidecar and stored on each chat thread).
- `providers[].base_url` is optional for `openai` / `anthropic`, and **required** for `openai_compatible`.

API keys:

- Keys are stored in `~/.redeven/secrets.json` (chmod `0600`) and never returned in plaintext.
- You can configure keys from the Env App UI: Settings → AI → Provider → API key.
- Multiple provider keys can be stored at the same time (keyed by `providers[].id`).
- Keys are injected into the sidecar process env as `REDEVEN_API_KEY` (fixed).

Example:

```json
{
  "controlplane_base_url": "https://<region>.<base-domain>",
  "environment_id": "env_xxx",
  "agent_instance_id": "ai_xxx",
  "direct": {
    "ws_url": "wss://...",
    "channel_id": "ch_..."
  },
  "permission_policy": {
    "schema_version": 1,
    "local_max": { "read": true, "write": true, "execute": true }
  },
  "ai": {
    "providers": [
      {
        "id": "openai",
        "type": "openai",
        "name": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "models": [
          { "model_name": "gpt-5-mini", "label": "GPT-5 Mini", "is_default": true },
          { "model_name": "gpt-5", "label": "GPT-5" }
        ]
      },
      {
        "id": "anthropic",
        "type": "anthropic",
        "name": "Anthropic",
        "base_url": "https://api.anthropic.com/v1",
        "models": [
          { "model_name": "claude-3-5-sonnet-latest", "label": "Claude Sonnet" }
        ]
      }
    ]
  }
}
```

## Safety / Approvals

Some tools are high-risk and require explicit user approval **every time**:

- `fs.write_file`
- `terminal.exec`

The Env App UI will show an Approve/Reject prompt for each such tool call.

See also:
- `PERMISSION_POLICY.md` for how the local RWX cap works (and what it does not cap).
- `CAPABILITY_PERMISSIONS.md` for the complete capability-to-permission mapping.
