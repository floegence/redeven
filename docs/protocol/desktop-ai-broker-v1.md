# Desktop AI Broker v1

This document describes the local-only broker used by Redeven Desktop to expose the `Desktop` model source for Desktop-managed SSH Host Environments.

## Goals

- Keep provider API keys on the user's machine.
- Let SSH Host Environments reuse Desktop's local Flower model configuration as an explicit `Desktop` source without writing secrets into the remote runtime config.
- Expose only model-oriented endpoints.
- Keep tool execution on the SSH host runtime.
- Keep SSH host opening independent from this optional model source.

## Transport

- Base URL: loopback-only `http://127.0.0.1:<port>`
- Authentication: short-lived bearer token in the `Authorization` header
- Lifetime: bound to the Desktop/SSH session that created it

Desktop binds the broker to the running SSH runtime through runtime-control after the Local UI forward is verified. The remote runtime receives only the forwarded broker URL and short-lived token for that live session, keeps them in memory, and does not persist them to config, secrets, logs, or startup command arguments.

Binding failure is non-fatal for the SSH connection. It only removes the `Desktop` source from the usable model-source list until the session is reopened or rebound; `Remote runtime` models remain available when the remote runtime has its own AI settings.

Runtime-control binding endpoint:

```text
POST /_redeven_proxy/api/runtime/bindings/desktop-ai-broker
```

The endpoint is available through the trusted Local UI route and updates `runtime_service.bindings.desktop_ai_broker`.

## Endpoints

### `GET /v1/status`

Returns broker availability and model summary.

Example response:

```json
{
  "connected": true,
  "available": true,
  "model_source": "desktop_local_environment",
  "model_count": 3,
  "missing_key_provider_ids": ["anthropic"]
}
```

### `GET /v1/models`

Returns the model snapshot visible to the Desktop-managed SSH runtime.

Example response:

```json
{
  "configured": true,
  "current_model": "openai/gpt-5-mini",
  "models": [
    {
      "id": "openai/gpt-5-mini",
      "provider_id": "openai",
      "provider_type": "openai",
      "model_name": "gpt-5-mini",
      "label": "OpenAI / gpt-5-mini"
    }
  ],
  "missing_key_provider_ids": ["anthropic"]
}
```

Model ids remain the runtime wire form `<provider_id>/<model_name>` at the broker boundary. The runtime rewrites them to the internal `desktop-broker:<provider_id>/<model_name>` wire form when it needs to preserve source metadata.

### `POST /v1/stream`

Streams a model turn as newline-delimited JSON frames.

Request body:

```json
{
  "request": {
    "model": "openai/gpt-5-mini",
    "messages": [],
    "tools": [],
    "budgets": {},
    "mode_flags": {},
    "provider_controls": {},
    "web_search_mode": ""
  }
}
```

Frame types:

- `event`: streamed provider event
- `result`: final `TurnResult`
- `error`: broker-side or provider-side failure

Example error:

```json
{"type":"error","error":{"code":"MODEL_NOT_USABLE","message":"desktop provider is missing its local API key"}}
```

## Error contract

Broker errors are intentionally narrow and human-readable. The runtime treats them as capability or availability failures, not as permission escalation hints.

Typical codes:

- `UNAUTHORIZED`
- `BROKER_NOT_CONFIGURED`
- `INVALID_JSON`
- `MODEL_NOT_ALLOWED`
- `MODEL_NOT_USABLE`
- `PROVIDER_NOT_FOUND`
- `KEY_LOOKUP_FAILED`
- `MISSING_API_KEY`
- `PROVIDER_INIT_FAILED`
- `PROVIDER_STREAM_FAILED`

## Non-goals

- No file, terminal, monitor, or port-forward RPCs.
- No API key transmission to the SSH host.
- No persisted remote `ai.enabled` flag or remote broker config.
- No runtime-control binding state in remote config; binding lives in the runtime snapshot and in memory only.
