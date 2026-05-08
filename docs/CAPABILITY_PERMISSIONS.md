# Capability-to-Permission Mapping

This document defines a stable mapping from **runtime capabilities** to **permission categories**.

It is intentionally public and reviewable: users should be able to audit what each permission enables.

Scope:
- Flowersec **RPC** (typed RPC `type_id`s)
- Flowersec **streams** (Yamux stream `kind`s)
- Local runtime **HTTP gateway APIs** under `/_redeven_proxy/api/*`
- Agent Skills / `redeven targets` **discovery metadata** exposed by the local CLI

## Permission Categories

- `read`
  - Non-destructive access (filesystem reads, safe queries, list endpoints).
  - May create/update **runtime-local metadata** used by the UI (e.g. AI threads, uploads), but must not mutate the **workspace filesystem** or execute commands.
- `write`
  - Workspace filesystem mutations (write/delete/rename/copy) and destructive deletes of runtime-local data.
  - High risk and should be explicitly enabled.
- `execute`
  - Command execution, interactive sessions, and network-forwarding style capabilities.
  - High risk and should be explicitly enabled.
- `admin`
  - Management actions (codespace management, settings updates, runtime maintenance operations, audit log access).
  - This is the namespace-level `admin` bit delivered in authoritative `session_meta`.

Notes:
- `write` does NOT imply `execute`, and vice versa.
- `execute=true` does NOT mean "read-only": terminal commands can still mutate files even when `write=false`. For strict read-only, require `write=false` **and** `execute=false`.
- `admin` is a separate capability dimension from RWX.
- Runtime-local AI uploads live under the runtime state directory rather than the workspace tree, but deleting threads/followups may reclaim those upload blobs and SQLite metadata as destructive runtime-local cleanup.
- UIs should treat permission denials as a normal capability state (not an exceptional error): when a capability is not granted (or is locally capped by `permission_policy`), stop polling and show a permission empty state.
- Agent Skills target discovery is metadata-only. `redeven targets list` and `redeven targets resolve` read local config/runtime state and do not grant file, terminal, monitor, Flower, Codex, or gateway access by themselves.

## Effective Permissions (Server-Issued Grant ∩ Endpoint Local Cap)

The Redeven runtime enforces permissions from two sources:

1) Session bootstrap: `session_meta` delivered by the Redeven service (authoritative grant).
2) Endpoint local: `permission_policy` in the runtime config (authoritative cap).

The runtime must always compute:

```
cap_rwx = permission_policy.local_max
if by_user[user_public_id] exists: cap_rwx = cap_rwx ∩ by_user[user_public_id]
if by_app[floe_app] exists: cap_rwx = cap_rwx ∩ by_app[floe_app]

effective_rwx = session_meta.rwx ∩ cap_rwx
effective_admin = session_meta.can_admin  // NOTE: not clamped by permission_policy
```

The customer-side runtime is not a control-plane authorization boundary: users can inspect or modify their local Redeven binary, UI assets, and config. Local policy may only narrow the server-issued grant; it must never expand `session_meta` or infer access to another environment/client from local state.

See also: [`PERMISSION_POLICY.md`](PERMISSION_POLICY.md).

## Data-Plane Capabilities

### RPC (Yamux stream kind: `rpc`)

| Domain | Capability | RPC type_id | Required permission | Source |
| --- | --- | ---: | --- | --- |
| FS | Get home | `1010` | `read` | `internal/fs/service.go` |
| FS | List directory | `1001` | `read` | `internal/fs/service.go` |
| FS | Read file (JSON) | `1002` | `read` | `internal/fs/service.go` |
| FS | Write file | `1003` | `write` | `internal/fs/service.go` |
| FS | Rename (file/dir) | `1004` | `write` | `internal/fs/service.go` |
| FS | Copy (file/dir) | `1005` | `write` | `internal/fs/service.go` |
| FS | Delete (file/dir) | `1006` | `write` | `internal/fs/service.go` |
| Terminal | Create session | `2001` | `execute` | `internal/terminal/manager.go` |
| Terminal | List sessions | `2002` | `execute` | `internal/terminal/manager.go` |
| Terminal | Attach session | `2003` | `execute` | `internal/terminal/manager.go` |
| Terminal | Output notify | `2004` | `execute` | `internal/terminal/manager.go` |
| Terminal | Resize notify | `2005` | `execute` | `internal/terminal/manager.go` |
| Terminal | Input notify | `2006` | `execute` | `internal/terminal/manager.go` |
| Terminal | History | `2007` | `execute` | `internal/terminal/manager.go` |
| Terminal | Clear | `2008` | `execute` | `internal/terminal/manager.go` |
| Terminal | Delete session | `2009` | `execute` | `internal/terminal/manager.go` |
| Terminal | Name update notify | `2010` | `execute` | `internal/terminal/manager.go` |
| Terminal | Session stats | `2011` | `execute` | `internal/terminal/manager.go` |
| Terminal | Sessions changed notify | `2012` | `execute` | `internal/terminal/manager.go` |
| Monitor | System monitor snapshot | `3001` | `execute` | `internal/monitor/service.go` |
| Sys | Ping | `4001` | `none (session required)` | `internal/sys/service.go` |
| Sys | Upgrade | `4002` | `admin` | `internal/sys/service.go` |
| Sys | Restart | `4003` | `admin` | `internal/sys/service.go` |
| Sessions | List active sessions | `5001` | `read` | `internal/agent/sessions_rpc.go` |

Design notes:
- Terminal "list/history" are classified as `execute` to avoid subtle privilege splits ("can observe but not control") under the current RWX model.
- If we ever need finer-grained terminal controls, we should introduce new permission dimensions instead of overloading `read/write/execute`.

### Streams (Yamux stream kind != `rpc`)

| Stream kind | Session (floe_app / code_space_id) | Purpose | Required permission | Source |
| --- | --- | --- | --- | --- |
| `fs/read_file` | any | Read raw file bytes (preview/download) | `read` | `internal/fs/stream_read_file.go` |
| `flowersec-proxy/http1` | `com.floegence.redeven.code` | HTTP proxy (code-server) | `read + write + execute` | `internal/agent/agent.go` |
| `flowersec-proxy/ws` | `com.floegence.redeven.code` | WebSocket proxy (code-server) | `read + write + execute` | `internal/agent/agent.go` |
| `flowersec-proxy/http1` | `com.floegence.redeven.portforward` | HTTP proxy (arbitrary reachable target) | `execute` | `internal/agent/agent.go` |
| `flowersec-proxy/ws` | `com.floegence.redeven.portforward` | WebSocket proxy (arbitrary reachable target) | `execute` | `internal/agent/agent.go` |
| `flowersec-proxy/http1` | `com.floegence.redeven.agent` + `code_space_id="env-ui"` | Env App UI static assets (runtime mode) | `none (session required)` | `internal/agent/agent.go` |

Notes:
- Proxy streams are enabled per-session. The same stream kind can require different permissions depending on `session_meta.floe_app` (and sometimes `code_space_id`).
- Code App is intentionally conservative: the runtime requires **all three** permission bits (`read`, `write`, `execute`) before it will serve `floe_app = com.floegence.redeven.code` (to avoid misleading "read-only code-server" semantics).
- `fs/read_file` is intentionally file-only. Directory targets, including symbolic links that resolve to directories, must fail before raw bytes are streamed.

## Local Gateway HTTP API Capabilities (`/_redeven_proxy/api/*`)

These endpoints are served by the local runtime gateway and delivered to the browser over Flowersec E2EE proxy.

Permissions are enforced by checking effective `session_meta` bits (see `internal/codeapp/gateway/gateway.go`).

Public contract (category level):

| Capability area | Required permission |
| --- | --- |
| Audit log access | `admin` |
| Settings read/write | `read` / `admin` |
| Codespace metadata management | `read` / `admin` |
| Codespace runtime operations (start/stop) | `execute` |
| Port forward lifecycle | `execute` |
| AI runs, uploads, and thread operations | `read + write + execute` |

For maintainability and security hygiene, this document keeps the permission contract public but does not enumerate
the complete management endpoint inventory. Exact endpoint paths remain discoverable in source:

- `internal/codeapp/gateway/gateway.go`

## Agent Skills CLI Discovery

The `redeven targets` command family is intentionally outside the data-plane capability model. It reads local runtime metadata and returns a protocol envelope for skill-aware agents.

| CLI surface | Purpose | Required permission |
| --- | --- | --- |
| `redeven targets list` | List local target descriptors from config/runtime state | Local OS user access to the state root |
| `redeven targets resolve` | Resolve a target id, label, env id, or local environment id | Local OS user access to the state root |

These commands do not mint sessions, expose `grant_client`, or bypass `session.Meta`. Any command that invokes a runtime capability must either use an existing runtime-authorized gateway/session path or introduce a reviewed permission mapping in this document.

## Adding New Capabilities (Policy Contract)

When introducing a new RPC type, stream kind, or gateway API:
1) Add it to this document with an explicit permission category.
2) Enforce the permission in code at the handler entry.
3) Add a unit test that demonstrates deny/allow behavior.

Changes to this mapping are **security-sensitive** and must be reviewed carefully.
