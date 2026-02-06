# Permission Policy (Local Cap)

Redeven agents enforce permissions from two sources:

1) Control-plane: `session_meta` delivered by control plane (authoritative grant).
2) Endpoint local: `permission_policy` in the agent config (authoritative cap).

The agent must always compute:

```
cap_rwx = permission_policy.local_max
if by_user[user_public_id] exists: cap_rwx = cap_rwx ∩ by_user[user_public_id]
if by_app[floe_app] exists: cap_rwx = cap_rwx ∩ by_app[floe_app]

effective_rwx = session_meta.rwx ∩ cap_rwx
effective_admin = session_meta.can_admin  // NOTE: not clamped by permission_policy
```

The local cap is designed to protect users from:
- accidental misconfiguration,
- overly-broad grants,
- and (in the worst case) compromised control-plane behavior.

Notes:
- The local cap only applies to `read/write/execute` (RWX).
- `can_admin` is a separate namespace-level capability bit delivered by control plane in `session_meta`.

## Config Schema

`~/.redeven/config.json`:

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
      "com.floegence.redeven.agent": { "read": true, "write": true, "execute": true }
    }
  }
}
```

Notes:
- `schema_version` and `local_max` are required when `permission_policy` exists.
- Unknown fields must be ignored for forward compatibility.

## Defaults

If `permission_policy` is missing, the recommended default local cap is:

- `execute = true`
- `read = true`
- `write = true`

Rationale:
- Redeven is a full remote development environment. Most users expect terminal, file editing, codespaces, and port forwarding to work out of the box.
- The local cap is still only a cap: the effective permissions are always clamped by the control-plane grant.

Security note:
- `execute=true` means terminal commands can mutate files even if `write=false`. Use the `read_only` preset for strict read-only (`execute=false, read=true, write=false`).

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
