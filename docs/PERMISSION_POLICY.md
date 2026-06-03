# Permission Policy (Local Cap)

The Redeven runtime enforces permissions from two sources:

1) Session bootstrap: `session_meta` delivered by the Redeven service (authoritative grant).
2) Endpoint local: `permission_policy` in the runtime config (authoritative cap).

The runtime must always compute:

```
cap_rwx = permission_policy.local_max
if user_public_id is non-empty and by_user[user_public_id] exists: cap_rwx = cap_rwx ∩ by_user[user_public_id]
if by_app[floe_app] exists: cap_rwx = cap_rwx ∩ by_app[floe_app]

effective_rwx = session_meta.rwx ∩ cap_rwx
effective_admin = session_meta.can_admin  // NOTE: not clamped by permission_policy
```

Filesystem access has one additional endpoint-local boundary: `filesystem_scope`.

```
effective_file_read(path)  = session_meta.read  ∩ permission_policy.read  ∩ filesystem_scope.root(path).read  ∩ OS user read permission
effective_file_write(path) = session_meta.write ∩ permission_policy.write ∩ filesystem_scope.root(path).write ∩ OS user write permission
```

`permission_policy` answers "which RWX capability class may this session/app use?". `filesystem_scope` answers "which local directories are exposed, and which of those roots are writable?". The runtime enforces both and still runs as the current operating-system user. A broad `read=true` grant cannot read outside configured filesystem roots, and a broad `write=true` grant cannot mutate a read-only root.

The local cap is designed to protect users from:
- accidental misconfiguration,
- overly-broad grants,
- and (in the worst case) buggy or compromised server-issued grants.

Notes:
- The local cap only applies to `read/write/execute` (RWX).
- `can_admin` is a separate namespace-level capability bit delivered in `session_meta`.
- `by_user` is only evaluated when the authoritative session has a non-empty `user_public_id`. Anonymous, local-only, or malformed sessions must not match an empty-string user key.
- Local UI uses the same per-app cap model as remote sessions. Env App UI itself resolves as `com.floegence.redeven.agent`, Code App routes resolve as `com.floegence.redeven.code`, and Port Forward routes/API actions resolve as `com.floegence.redeven.portforward`.
- `filesystem_scope` is intentionally separate from the RWX cap so users can expose Home read/write, Computer read-only, and selected custom roots without changing the high-level permission category model.
- Computer defaults to read-only. When the Files sidebar toggles Computer to `RW`, the runtime only allows writes that also pass `session_meta`, `permission_policy`, the filesystem root policy, symlink-safe scope resolution, and the OS user's own filesystem permissions. It is not a privilege escalation mechanism.

## Config Schema

`~/.redeven/local-environment/config.json` (or the equivalent `config.json` inside the Local Environment state directory):

```json
{
  "permission_policy": {
    "schema_version": 1,
    "local_max": {
      "read": true,
      "write": true,
      "execute": true
    },
    "by_user": {
      "user_xxx": { "read": true, "write": false, "execute": false }
    },
    "by_app": {
      "com.floegence.redeven.agent": { "read": true, "write": true, "execute": true },
      "com.floegence.redeven.code": { "read": true, "write": true, "execute": false },
      "com.floegence.redeven.portforward": { "read": true, "write": true, "execute": false }
    }
  },
  "agent_home_dir": "/Users/alice",
  "filesystem_scope": {
    "schema_version": 1,
    "default_root_id": "home",
    "roots": [
      {
        "id": "home",
        "label": "Home",
        "path": "/Users/alice",
        "kind": "home",
        "permissions": { "read": true, "write": true },
        "system": true
      },
      {
        "id": "computer",
        "label": "Computer",
        "path": "/",
        "kind": "computer",
        "permissions": { "read": true, "write": false },
        "system": true
      },
      {
        "id": "projects",
        "label": "Projects",
        "path": "/Volumes/Work/projects",
        "kind": "custom",
        "permissions": { "read": true, "write": true }
      }
    ]
  }
}
```

Notes:
- `schema_version` and `local_max` are required when `permission_policy` exists.
- Unknown fields must be ignored for forward compatibility.
- `agent_home_dir` is the default home/working directory and the expansion target for `~`; it is not the filesystem access boundary.
- If `filesystem_scope` is missing, the runtime derives a writable Home root from `agent_home_dir` plus a read-only Computer root at the operating-system root.
- Filesystem root paths must resolve to existing local directories. Custom roots are configured in Runtime Settings, and root write changes from either Runtime Settings or the Files sidebar take effect through the same settings update path by rebuilding the shared runtime filesystem registry.

## Defaults

If `permission_policy` is missing, the recommended default local cap is:

- `execute = true`
- `read = true`
- `write = true`

Rationale:
- Redeven is a full remote development environment. Most users expect terminal, file editing, codespaces, and Web Services / port-forward routing to work out of the box.
- The local cap is still only a cap: the effective permissions are always clamped by the server-issued grant.

Security note:
- `execute=true` means terminal commands can mutate files according to the operating-system user's own permissions even if `write=false` or the current filesystem root is read-only in Redeven's file APIs. Use the `read_only` preset for strict read-only (`execute=false, read=true, write=false`).

## Bootstrap CLI

`redeven bootstrap` can write `permission_policy` into the config file.

Recommended usage (presets):

```bash
redeven bootstrap ... --permission-policy execute_read
redeven bootstrap ... --permission-policy read_only
redeven bootstrap ... --permission-policy execute_read_write
```

Preset meaning:
- `execute_read_write` (default): `execute=true, read=true, write=true`
- `execute_read`: `execute=true, read=true, write=false`
- `read_only`: `execute=false, read=true, write=false`

## Relation to Capabilities

For a complete list of RPC/stream capabilities and their required permission category, see:

- [`CAPABILITY_PERMISSIONS.md`](CAPABILITY_PERMISSIONS.md)
