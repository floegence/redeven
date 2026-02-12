# AI Settings & Secrets (Recommended Design)

This document describes the recommended, stable design for **AI configuration management** in the Redeven agent.

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

- `type` is one of: `openai` | `anthropic` | `openai_compatible`
- `base_url` is optional for `openai`/`anthropic`, and required for `openai_compatible`
- Provider auth env var names are intentionally **not configurable** in config or UI

---

## 3. Model Registry (Provider-Owned, Stable on Wire)

The wire model id remains:

```
<provider_id>/<model_name>
```

But the config stores models under each provider (provider + model are always configured together):

```json
{
  "id": "openai",
  "type": "openai",
  "name": "OpenAI",
  "models": [
    { "model_name": "gpt-5-mini", "label": "GPT-5 Mini", "is_default": true },
    { "model_name": "gpt-5", "label": "GPT-5" }
  ]
}
```

Rules:

- `providers[].models[]` is the allow-list shown in the Chat UI.
- Exactly one `providers[].models[].is_default` must be true across all providers (default for new chats).
- `model_name` must not contain `/` (wire id uses `/` as a delimiter).
- The agent derives the wire id as `provider.id + "/" + model_name` when talking to runtime providers and when returning `/api/ai/models`.

Thread-level selection:

- Each chat thread stores its selected `model_id` (wire id).
- New chats start with the config default.
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

## 5. UI Flow (Env App → Settings → AI)

- Providers:
  - “Add Provider” generates a provider id automatically.
  - Users edit `name`, `type`, `base_url`.
  - Provider id is displayed read-only (useful for debugging / advanced JSON edits).
- API keys:
  - Stored locally in `secrets.json`, never shown again.
  - UI shows `Key set / Key not set`, with `Save key` and `Clear`.
- Models:
  - Configured inside each provider as `models[]` (`model_name` + optional `label`).
  - One model across all providers is marked **Default** (used for new chats).
  - Chat header shows a single **Model** selector (no separate provider dropdown).

---

## 6. Permissions (Current Policy)

- Running AI: requires `read` permission (normal members can use it).
- Editing settings or updating keys: requires `admin` permission (local endpoint owner / admin only).

This keeps usage accessible while protecting local secret writes.
