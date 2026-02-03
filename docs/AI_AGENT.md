# AI Agent (Optional)

Redeven Agent can optionally enable an **AI Agent** feature inside the Env App UI.

High-level design:

- The browser UI calls the agent via the existing `/_redeven_proxy/api/ai/*` gateway routes (still over Flowersec E2EE proxy).
- The **Go agent is the security boundary** and executes tools (filesystem, terminal) after validating authoritative `session_meta`.
- A bundled **TypeScript sidecar** process (Node.js) runs the LLM orchestration (tool calling / multi-step loop) via the Vercel AI SDK.

## Requirements

- Node.js `>= 20` available on `PATH` as `node` (the agent spawns the sidecar as `node sidecar.mjs`).
- Provider API keys must be provided via environment variables (never store secrets in `config.json`).

## Configuration

Enable the feature by adding an `ai` section to the agent config file (default: `~/.redeven-agent/config.json`).

Notes:

- `default_model` format is `<provider_id>/<model_name>`.
- `models` is an optional allow-list. If provided, `default_model` must be listed.
- `providers[].base_url` is optional for `openai` / `anthropic`, and **required** for `openai_compatible`.
- `providers[].api_key_env` is the environment variable name holding the API key.

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
    "can_read_files": true,
    "can_write_files": true,
    "can_execute": true
  },
  "ai": {
    "default_model": "openai/gpt-5-mini",
    "models": [
      { "id": "openai/gpt-5-mini", "label": "GPT-5 Mini" },
      { "id": "anthropic/claude-3-5-sonnet-latest", "label": "Claude Sonnet" }
    ],
    "providers": [
      {
        "id": "openai",
        "type": "openai",
        "base_url": "https://api.openai.com/v1",
        "api_key_env": "OPENAI_API_KEY"
      },
      {
        "id": "anthropic",
        "type": "anthropic",
        "base_url": "https://api.anthropic.com/v1",
        "api_key_env": "ANTHROPIC_API_KEY"
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

