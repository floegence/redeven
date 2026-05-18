# Desktop Model Source RPC v1

Desktop Model Source RPC lets a Desktop-managed runtime use the user's Desktop
Local Environment model settings without copying provider config or secrets into
SSH hosts or containers.

## Security Boundary

- Desktop owns `config.json`, `secrets.json`, provider adapters, and provider API
  keys.
- Runtime owns context gathering, permission checks, tool execution, thread
  persistence, and Flower UI gateway routes.
- Runtime-control is loopback-only and requires both the runtime-control bearer
  token and `X-Redeven-Desktop-Owner-ID`.
- Runtime never dials back to the user's machine. Desktop initiates the RPC
  connection through the runtime-control endpoint that is already available for
  the selected runtime.
- SSH environments do not use reverse forwarding for model calls. Container
  runtimes use the Runtime Placement Bridge runtime-control surface.
- Desktop model source connection is part of Desktop `Open` connection setup,
  not runtime lifecycle startup. `Start runtime` only needs the runtime to report
  a compatible Runtime Service and runtime-control endpoint; each Desktop
  process opens, refreshes, and tears down the model-source session with the
  current SSH tunnel or container bridge.

## Runtime Service Surface

Runtime Service snapshots expose the capability and live binding under
`desktop_model_source`:

```json
{
  "capabilities": {
    "desktop_model_source": {
      "supported": true,
      "bind_method": "runtime_control_v1"
    }
  },
  "bindings": {
    "desktop_model_source": {
      "state": "bound",
      "session_id": "dms_...",
      "model_source": "desktop_local_environment",
      "model_count": 2,
      "missing_key_provider_ids": [],
      "connected_at_unix_ms": 1778750000000,
      "expires_at_unix_ms": 1778793200000
    }
  }
}
```

`state` is one of `unbound`, `connecting`, `bound`, `error`, `expired`, or
`unsupported`.

## Runtime-Control Endpoints

All endpoints are rooted at the runtime-control service base URL. Bridge-backed
runtimes may expose that base URL under a path prefix such as
`/__redeven_runtime_control/`.

```text
GET  /v1/desktop-model-source
POST /v1/desktop-model-source/connect
POST /v1/desktop-model-source/disconnect
GET  /v1/desktop-model-source/rpc?session_id=...
```

`connect` prepares the runtime-side binding:

```json
{
  "session_id": "dms_...",
  "source": "desktop_local_environment",
  "protocol_version": "redeven-desktop-model-source-rpc-v1",
  "expires_at_unix_ms": 1778793200000
}
```

`rpc` upgrades to WebSocket. Desktop opens the socket, then Runtime sends request
frames over that socket.

## Frame Envelope

Every WebSocket message is a JSON frame:

```json
{
  "protocol_version": "redeven-desktop-model-source-rpc-v1",
  "id": "dms_rpc_...",
  "type": "request",
  "method": "ai.models.list",
  "params": {}
}
```

Frame types:

- `request`: Runtime asks Desktop to run a method.
- `event`: Desktop streams a Flower event for a request.
- `result`: Desktop completes a request.
- `error`: Desktop fails a request with `{ code, message }`.
- `cancel`: Runtime cancels an active request.
- `ping` / `pong`: transport health.

Methods:

- `ai.status.get`
- `ai.models.list`
- `ai.turn.stream`
- `ai.turn.cancel`

Desktop model ids are opaque:

```text
desktop:model_<stable_hash>
```

Runtime must not infer provider id, provider type, model name, base URL, or API
key location from that id. Desktop keeps the session-local mapping and resolves
provider calls locally.
