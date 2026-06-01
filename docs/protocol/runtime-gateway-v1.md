# Runtime Gateway Protocol v1

Runtime Gateway is the minimal Runtime/Desktop contract for discovering local
runtime-managed environments and asking the runtime to open an environment
session. This skeleton intentionally stops before the Portal or Metaserver
authorization loop.

## Capability

Runtime Service snapshots advertise support through:

```json
{
  "capabilities": {
    "runtime_gateway": {
      "supported": true,
      "bind_method": "runtime_control_v1"
    }
  }
}
```

Older snapshots may omit `runtime_gateway`. Desktop must normalize the missing
field as unsupported.

## Catalog

Catalog responses use `snake_case` JSON field names:

```json
{
  "protocol_version": "redeven-runtime-gateway-v1",
  "environments": []
}
```

The first implementation may return an empty environment list.

## Open Session

Open-session requests carry only stable environment identity and optional client
correlation metadata:

```json
{
  "protocol_version": "redeven-runtime-gateway-v1",
  "env_public_id": "env_example",
  "client_session_id": "desktop-request-1"
}
```

The skeleton validates `env_public_id`, then returns a typed `NOT_IMPLEMENTED`
error. Credential-bearing fields are deliberately absent from these wire
contracts until the authorization flow is designed end to end.
