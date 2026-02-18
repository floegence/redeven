# Flower Settings & Secrets (Recommended Design)

This document describes the recommended, stable design for **Flower (AI assistant) configuration management** in the Redeven agent.

Goals:

- Intuitive UI: users **paste API keys directly**, never configure env var names.
- Safe storage: secrets are stored locally, never written to `config.json`, never returned to the UI.
- Deterministic runtime: the effective API key is always the one configured in the local secrets store.
- Multi-provider: configure multiple providers and their keys at the same time.
- Native SDK runtime: OpenAI/Anthropic calls are executed by Go provider adapters (wire model id stays `<provider_id>/<model_name>`).

Non-goals:

- Backward compatibility for older AI settings layouts (project is still in development; we keep configs clean).

---

## 1. Config vs Secrets (Two-File Model)

We deliberately split configuration into two local files:

1) `~/.redeven/config.json` (non-secret settings)

- Control-plane bootstrap fields + local preferences.
- Contains AI provider registry and allowed models.
- Must **never** contain provider API keys.

2) `~/.redeven/secrets.json` (user-provided secrets, chmod `0600`)

- Stores AI provider API keys (and future user secrets).
- Never returned in plaintext; UI only gets derived status (e.g. `key_set=true/false`).

This separation keeps the UI intuitive and reduces the blast radius of accidental logs / bug reports.

---

## 2. Provider Registry (Stable ID + Display Name)

### 2.1 Why a stable internal provider id?

Provider keys are stored in `secrets.json` keyed by `provider_id`. If the id were user-editable, a rename would silently break:

- model routing (`<provider_id>/<model_name>`)
- key lookup (secrets are keyed by id)

So we use:

- `provider.id`: stable internal key (generated automatically by the UI; not user-editable)
- `provider.name`: human-friendly display name (editable; safe to change any time)

This is the common “immutable primary key + mutable display name” pattern.

### 2.2 Provider schema (stored in `config.json`)

```json
{
  "id": "openai",
  "name": "OpenAI",
  "type": "openai",
  "base_url": "https://api.openai.com/v1"
}
```

Notes:

- `type` is one of: `openai` | `anthropic` | `openai_compatible` | `moonshot`
- `base_url` is optional for `openai`/`anthropic`, and required for `openai_compatible`/`moonshot`
- `moonshot` uses Moonshot's Chat Completions compatible endpoint on the configured `base_url` (for example `https://api.moonshot.cn/v1`)
- Provider auth env var names are intentionally **not configurable** in config or UI

---

## 3. Model Registry (Provider-Owned, Stable on Wire)

The wire model id remains:

```
<provider_id>/<model_name>
```

But the config keeps `current_model_id` at the AI root, and stores models under each provider:

```json
{
  "current_model_id": "openai/gpt-5-mini",
  "providers": [
    {
      "id": "openai",
      "type": "openai",
      "name": "OpenAI",
      "models": [
        { "model_name": "gpt-5-mini" },
        { "model_name": "gpt-5" }
      ]
    }
  ]
}
```

Rules:

- `providers[].models[]` is the allow-list shown in the Chat UI.
- `current_model_id` must point to one allowed model id (`<provider_id>/<model_name>`).
- When `current_model_id` is missing/invalid after provider/model edits, the system falls back to the first available model.
- `model_name` must not contain `/` (wire id uses `/` as a delimiter).
- The agent derives the wire id as `provider.id + "/" + model_name` when talking to runtime providers and when returning `/api/ai/models`.

Thread-level selection:

- Each chat thread stores its selected `model_id` (wire id).
- New chats start with `current_model_id`.
- Switching threads automatically follows the thread's `model_id`.

---

## 4. API Key Handling (Go Native Runtime)

Key points:

- The UI never asks users to pick an env var name.
- For each run, the Go runtime:
  1) resolves key by `provider_id` from `secrets.json`
  2) initializes provider SDK client with that key (`openai-go` / `anthropic-sdk-go`)
  3) never writes key back to `config.json` or API responses

---

## 5. UI Flow (Env App → Settings → Flower)

- Providers:
  - “Add Provider” generates a provider id automatically.
  - Users edit `name`, `type`, `base_url`.
  - Provider id is displayed read-only (useful for debugging / advanced JSON edits).
- Current model:
  - A single `current_model_id` controls which model is used by default for new chats.
  - Chat model selection automatically updates `current_model_id`.
- API keys:
  - Stored locally in `secrets.json`, never shown again.
  - UI shows `Key set / Key not set`, with `Save key` and `Clear`.
- Models:
  - Configured inside each provider as `models[]` (`model_name` only).
  - Chat header shows a single **Model** selector (no separate provider dropdown), displayed as `<provider name> / <model_name>`.

---

## 6. Permissions (Current Policy)

- Running AI: requires `read + write + execute` permission (RWX / "full").
- Editing settings or updating keys: requires `admin` permission (local endpoint owner / admin only).

This keeps local secret writes protected while ensuring Flower only runs in fully-privileged (RWX) sessions.

---

## 7. Execution Policy (Runtime Guardrails)

`ai.execution_policy` defines optional hard guardrails:

```json
{
  "execution_policy": {
    "require_user_approval": false,
    "enforce_plan_mode_guard": false,
    "block_dangerous_commands": false
  }
}
```

Default values are intentionally permissive (all `false`):

- `require_user_approval`: when enabled, mutating tools require explicit approval.
- `enforce_plan_mode_guard`: when enabled, mutating tools are hard-blocked in `plan` mode.
- `block_dangerous_commands`: when enabled, dangerous `terminal.exec` commands are hard-blocked.

Operational behavior:

- `act` mode is direct execution by default.
- `plan` mode is prompt-guided analysis by default (soft guidance, no hard readonly lock unless explicitly enabled).
- Settings UI exposes these switches under **Settings → Flower → Execution policy**.
