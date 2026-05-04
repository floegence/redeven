# Flower Settings & Secrets

This document describes the current configuration and local secret model for Flower in Redeven.

Codex is documented separately in [`docs/CODEX_UI.md`](CODEX_UI.md). It does not share Flower providers, Flower settings shape, or Flower secret storage rules, and Redeven does not persist Codex runtime defaults in `config.json`.

## Goals

- Users paste API keys directly instead of configuring environment-variable names.
- Secrets are stored locally and never written into `config.json`.
- Provider and model selection stay deterministic on the wire.
- The runtime uses native Go SDK adapters.

Backward compatibility for older AI settings layouts is intentionally out of scope.

## 1. Config vs secrets

Flower deliberately splits non-secret settings and secrets into two local files:

1. `~/.redeven/local-environment/config.json`
   - bootstrap connection data
   - provider registry
   - allowed models
   - execution policy

2. `~/.redeven/local-environment/secrets.json`
   - provider API keys
   - future user secrets

The UI never receives stored plaintext secrets back from the runtime. It only gets derived state such as `key_set=true`.

## 2. Provider registry

Providers are stored in `config.json` with a stable internal id and a mutable display name.

Example:

```json
{
  "id": "openai",
  "name": "OpenAI",
  "type": "openai",
  "base_url": "https://api.openai.com/v1"
}
```

Rules:

- `provider.id` is stable and is used for secret lookup and wire model ids.
- `provider.name` is user-facing and can be changed.
- `type` is one of:
  - `openai`
  - `anthropic`
  - `moonshot`
  - `chatglm`
  - `deepseek`
  - `qwen`
  - `openai_compatible`
- `base_url` is optional for native providers and required for OpenAI-compatible providers that need a custom endpoint.

## 3. Model registry

The wire model id remains:

```text
<provider_id>/<model_name>
```

Models are stored under each provider in `config.json`, while `current_model_id` lives at the AI root and determines the default model for new chats.

Important rules:

- `providers[].models[]` is the allow-list exposed to the UI.
- `current_model_id` must reference one allowed wire id.
- If the stored `current_model_id` becomes invalid, the runtime falls back to the first available model.
- `model_name` must not contain `/`.
- `context_window` is used by runtime budgeting.
- `max_output_tokens` and `effective_context_window_percent` are optional overrides.

Each thread stores its own selected `model_id`; switching threads follows the thread selection instead of a global session override. Updating a thread model never rewrites `current_model_id`.

## 4. Runtime key handling

For each run the Go runtime:

1. resolves the API key from `secrets.json` by `provider_id`
2. initializes the provider SDK client
3. never writes the key back into `config.json` or API responses

## 5. UI behavior

Current Runtime Settings UI behavior is:

- Flower lives under Runtime Settings -> `AI & Extensions` as its own card, while permission policy and diagnostics stay in separate top-level groups.
- Add Provider generates a provider id automatically.
- Provider id is shown as read-only.
- API keys are stored locally and shown only as status (`Key set` / `Key not set`).
- Models are configured inside each provider entry.
- In a draft chat with no active thread, the chat model picker updates `current_model_id` immediately for future new chats.
- In an active unlocked thread, the chat model picker updates only that thread's `model_id`.
- Locked threads show the current thread model as read-only instead of as an editable picker.

## 6. Permissions

Current permission policy is:

- Running Flower requires `read + write + execute`.
- Updating settings or secrets requires `admin`.

This keeps local secret writes behind endpoint-owner or admin control.

## 7. Execution policy

`ai.execution_policy` defines optional hard guardrails:

```json
{
  "execution_policy": {
    "require_user_approval": false,
    "block_dangerous_commands": false
  }
}
```

Current behavior:

- `act` mode executes directly unless a guardrail blocks a tool call.
- `plan` mode is always readonly.
- In `plan`, readonly shell inspection remains allowed, including readonly HTTP fetches that only stream to stdout.
- In `plan`, HTTP commands that write local files/state or send request bodies/uploads remain blocked as mutating actions.
- Execution mode is stored per thread and enforced server-side.
- If a task in `plan` requires edits, Flower must ask for a mode switch when interaction is allowed.

The execution-policy UI is exposed under Runtime Settings -> `AI & Extensions` -> Flower -> Execution policy.

## 8. Terminal execution policy

`ai.terminal_exec_policy` controls the bounded execution contract for `terminal.exec`:

```json
{
  "terminal_exec_policy": {
    "default_timeout_ms": 120000,
    "max_timeout_ms": 600000
  }
}
```

Current behavior:

- If `terminal.exec.timeout_ms` is omitted, Flower applies `default_timeout_ms`.
- Any requested `timeout_ms` is capped at `max_timeout_ms`.
- The built-in defaults are Claude-style:
  - `default_timeout_ms = 120000`
  - `max_timeout_ms = 600000`
- Timeout and cancel handling terminate the full shell process tree/group when the platform supports it.
