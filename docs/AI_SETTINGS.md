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
   - optional Brave web-search API keys for OpenAI-compatible providers
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
- `base_url` is optional for OpenAI and Anthropic, and required for Moonshot, GLM/Z.ai, DeepSeek, Qwen, and OpenAI-compatible providers.
- `web_search` is valid only for `openai_compatible` providers.

OpenAI-compatible web-search example:

```json
{
  "id": "compat",
  "name": "Custom Gateway",
  "type": "openai_compatible",
  "base_url": "https://gateway.example/v1",
  "web_search": { "mode": "brave" },
  "models": [
    { "model_name": "custom-model", "context_window": 128000 }
  ]
}
```

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
- Native provider model support is an explicit allow-list, not a prefix match:
  - Moonshot: `kimi-k2.6`
  - GLM/Z.ai: `glm-5.1`
  - DeepSeek: `deepseek-v4-pro`, `deepseek-v4-flash`
  - Qwen: `qwen3.6-plus`, `qwen3.6-plus-2026-04-02`, `qwen3.6-flash`, `qwen3.6-flash-2026-04-16`

Each thread stores its own selected `model_id`; switching threads follows the thread selection instead of a global session override. Updating a thread model never rewrites `current_model_id`.

## 4. Web search policy

Native providers do not show web-search configuration in Settings:

- OpenAI uses hosted Responses web search on official OpenAI endpoints.
- Moonshot `kimi-k2.6` uses Kimi `$web_search` and disables thinking for those requests because Kimi documents that requirement.
- GLM/Z.ai `glm-5.1` uses the provider `web_search` tool with `search_result=true`.
- DeepSeek V4 Pro/Flash use an isolated DeepSeek-native search decorator so their schema can evolve without changing generic OpenAI-compatible behavior.
- Qwen3.6 Plus/Flash use the provider Responses API `web_search` tool for the explicit Qwen3.6 model IDs listed above.

Only `openai_compatible` providers may set `providers[].web_search.mode`:

- `disabled`: no web-search capability is exposed for that provider.
- `openai_builtin`: attach OpenAI Responses-style hosted web search for a compatible gateway.
- `brave`: expose Flower's external Brave-backed `web.search` tool.

Official source references:

- Moonshot: `https://platform.kimi.ai/docs/models`, `https://platform.kimi.ai/docs/guide/use-web-search`
- GLM/Z.ai: `https://docs.bigmodel.cn/cn/guide/models/text/glm-5.1`, `https://docs.bigmodel.cn/cn/guide/tools/web-search`
- DeepSeek: `https://api-docs.deepseek.com/api/list-models/`, `https://api-docs.deepseek.com/api/create-chat-completion`
- Qwen: `https://help.aliyun.com/zh/model-studio/text-generation-model/`, `https://help.aliyun.com/zh/model-studio/web-search`

## 5. Runtime key handling

For each run the Go runtime:

1. resolves the API key from `secrets.json` by `provider_id`
2. initializes the provider SDK client
3. never writes the key back into `config.json` or API responses
4. resolves a Brave API key only when the selected OpenAI-compatible provider uses `web_search.mode = "brave"`

## 6. Desktop broker sessions for SSH Host Environments

When Redeven Desktop opens an SSH Host Environment, the remote runtime may use the Desktop Local Environment's Flower model configuration through a short-lived Desktop AI Broker session.

This is deliberately different from copying settings to the SSH host:

- The Desktop Local Environment keeps provider API keys in its own `secrets.json`.
- The SSH host receives only a forwarded loopback broker URL plus a short-lived bearer token for that Desktop session.
- The remote runtime stores that broker endpoint in memory only and clears the startup environment variables immediately after reading them.
- The SSH host's `config.json` does not gain an `ai` section, provider keys, or an `enabled` boolean.
- Remote tools, file reads, terminal commands, Git operations, and permission checks still execute in the SSH-hosted runtime.

The API response field `ai_runtime.desktop_broker` reports broker session status separately from the persisted `ai` config. Env App uses that field to show whether the model is coming from `Desktop` while tools are running on `SSH Host`.

## 7. UI behavior

Current Runtime Settings UI behavior is:

- Flower lives under Runtime Settings -> `AI & Extensions` as its own card, while permission policy and diagnostics stay in separate top-level groups.
- On SSH Host sessions, the Flower card separates persisted remote provider settings from the Desktop broker session capability.
- Add Provider generates a provider id automatically.
- Provider id is shown as read-only.
- API keys are stored locally and shown only as status (`Key set` / `Key not set`).
- Web search controls are shown only inside OpenAI-compatible provider editing.
- Native providers show built-in web-search status only; they do not show Brave or hosted-search configuration.
- Models are configured inside each provider entry.
- In a draft chat with no active thread, the chat model picker updates `current_model_id` immediately for future new chats.
- In an active unlocked thread, the chat model picker updates only that thread's `model_id`.
- Locked threads show the current thread model as read-only instead of as an editable picker.

## 8. Permissions

Current permission policy is:

- Running Flower requires `read + write + execute`.
- Updating settings or secrets requires `admin`.

This keeps local secret writes behind endpoint-owner or admin control.

## 9. Execution policy

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

## 9. Terminal execution policy

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
