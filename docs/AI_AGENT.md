# AI Agent (Optional)

Redeven Agent can optionally enable an **AI Agent** feature inside the Env App UI.

High-level design:

- The browser UI calls the agent via the existing `/_redeven_proxy/api/ai/*` gateway routes (still over Flowersec E2EE proxy).
- The **Go agent is the security boundary** and executes tools after validating authoritative `session_meta`.
- Tooling follows a shell-first workflow: `terminal.exec` for investigation and verification, `apply_patch` for file edits.
- LLM orchestration runs in the **Go runtime** via native provider SDK adapters:
  - OpenAI: `openai-go` (Responses API)
  - Anthropic: `anthropic-sdk-go` (Messages API)

## Requirements

- Runtime path does **not** require Node.js.
- Provider API keys are stored locally in a separate secrets file (never store secrets in `config.json`).

## Configuration

Enable the feature by adding an `ai` section to the agent config file (default: `~/.redeven/config.json`).

Notes:

- Providers own their model list: `ai.providers[].models[]` is the allow-list shown in the Chat UI.
- Exactly one `providers[].models[].is_default` must be true (default for new chats).
- The wire model id remains `<provider_id>/<model_name>` (stored on each chat thread).
- `providers[].base_url` is optional for `openai` / `anthropic`, and **required** for `openai_compatible`.

API keys:

- Keys are stored in `~/.redeven/secrets.json` (chmod `0600`) and never returned in plaintext.
- You can configure keys from the Env App UI: Settings → AI → Provider → API key.
- Multiple provider keys can be stored at the same time (keyed by `providers[].id`).
- At runtime, Go resolves the provider key from local secrets per run and injects it directly into the provider SDK client.

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
    "execution_policy": {
      "require_user_approval": false,
      "enforce_plan_mode_guard": false,
      "block_dangerous_commands": false
    },
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

## Tooling and execution policy

Built-in tools:

- `terminal.exec`
- `apply_patch`

Hard guardrails are controlled by `ai.execution_policy`:

- `require_user_approval`: when true, mutating tool calls require explicit user approval.
- `enforce_plan_mode_guard`: when true, mutating tools are hard-blocked in `plan` mode.
- `block_dangerous_commands`: when true, dangerous `terminal.exec` commands are hard-blocked.

Default values are intentionally permissive:

- `require_user_approval = false`
- `enforce_plan_mode_guard = false`
- `block_dangerous_commands = false`

Behavior summary:

- `act` mode executes tools directly by default.
- `plan` mode uses prompt-level guidance (analysis-first), not a hard readonly lock by default.
- The Env App shows approval prompts only when `require_user_approval` is enabled.

Installer note:

- `scripts/install.sh` installs pinned ripgrep binaries into `~/.redeven/tools/rg/<version>/<platform>/rg` and links `~/.redeven/bin/rg`, so shell-first search is available even when the system does not provide `rg`.

See also:
- `PERMISSION_POLICY.md` for how the local RWX cap works (and what it does not cap).
- `CAPABILITY_PERMISSIONS.md` for the complete capability-to-permission mapping.
