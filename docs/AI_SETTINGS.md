# AI Settings & Secrets (Recommended Design)

This document describes the recommended, stable design for **AI configuration management** in the Redeven agent.

Goals:

- Intuitive UI: users **paste API keys directly**, never configure env var names.
- Safe storage: secrets are stored locally, never written to `config.json`, never returned to the UI.
- Deterministic runtime: the effective API key injected into the AI sidecar is always the one configured in the local secrets store.
- Multi-provider: configure multiple providers and their keys at the same time.
- Low-risk integration: keep the TypeScript sidecar + Vercel AI SDK call path stable (wire model id stays `<provider_id>/<model_name>`).

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
- The API key env var name is intentionally **not configurable** in config or UI

---

## 3. Model Registry (Structured in Config, Stable on Wire)

The wire format for running a model remains:

```
<provider_id>/<model_name>
```

But the config storage uses structured fields to avoid stringly-typed mistakes and to make the UI better:

```json
{
  "provider_id": "openai",
  "model_name": "gpt-5-mini"
}
```

Allow-list items extend that with an optional `label`:

```json
{
  "provider_id": "openai",
  "model_name": "gpt-5-mini",
  "label": "GPT-5 Mini"
}
```

The agent derives the wire id as `provider_id + "/" + model_name` when talking to the sidecar and when returning `/api/ai/models`.

---

## 4. API Key Handling (Fixed Env Var: `REDEVEN_API_KEY`)

Key points:

- The sidecar reads the provider API key from a **single** env var: `REDEVEN_API_KEY`.
- The UI never asks users to pick an env var name.
- When starting a run, the Go agent:
  1) resolves the key from `secrets.json` by `provider_id`
  2) injects it into the sidecar process environment as `REDEVEN_API_KEY=<key>`
  3) strips any inherited `REDEVEN_API_KEY` from the parent process env to keep behavior deterministic

This achieves both an intuitive UX and stable runtime behavior.

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
  - Default model uses provider dropdown + model name input.
  - Optional allow-list uses the same structured inputs.

---

## 6. Permissions (Current Policy)

- Running AI: requires `read` permission (normal members can use it).
- Editing settings or updating keys: requires `admin` permission (local endpoint owner / admin only).

This keeps usage accessible while protecting local secret writes.
