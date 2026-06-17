# Gateway Protocol v1

Gateway Protocol is a local Desktop-to-Gateway contract. It lets Redeven Desktop
discover environments explicitly managed by a `redeven-gateway` service, create
or delete Gateway-owned environment profiles when the Gateway advertises profile
write capability, and ask that Gateway to open a short-lived local session. It
does not register anything in Portal, Metaserver, Region Center, RCPP, or
OpenAPI.

## Boundary

Gateway state is local to Desktop and the Gateway service:

- Desktop stores Gateway connection records and trust profiles locally.
- Gateway catalog is derived from the Gateway service profile store.
- Gateway catalog does not expose the Gateway host itself as a default
  environment. If the host should be used as an environment, the user must
  create an explicit Gateway-owned profile.
- Gateway open-session does not call Region channel init, does not mint grants,
  does not use tunnel, and does not write `session_meta`.
- Gateway identities are `gateway_id` and `gateway_env_id`; `env_public_id` is
  not part of this protocol.

## Gateway Service

Gateway runs as its own service and binary:

- Runtime binary: `redeven`
- Gateway binary: `redeven-gateway`
- Runtime managed slot: `~/.redeven/runtime/managed/bin/redeven`
- Gateway managed slot: `~/.redeven/gateway/managed/bin/redeven-gateway`
- Gateway state root: `~/.redeven/gateways/<gateway_id>/state`

Gateway and runtime can be installed on the same host, but their install slots,
state, lifecycle, and upgrade actions are independent. Desktop must not treat a
Gateway service start, stop, restart, or update as a runtime lifecycle action.

## Pairing

Pairing is a local trust protocol between Desktop main and Gateway service.
It never goes through Portal.

### Challenge

`POST /gateway/v1/pairing/challenge`

```json
{
  "protocol_version": "redeven-gateway-v1",
  "client_nonce": "desktop-generated-nonce",
  "client_public_key": "ed25519-public-key",
  "binding_audience": "https://gateway.example.internal",
  "pairing_code": "123456"
}
```

Response:

```json
{
  "protocol_version": "redeven-gateway-v1",
  "gateway_id": "gw_bastion",
  "gateway_public_key": "ed25519-public-key",
  "gateway_public_key_fingerprint": "SHA256:...",
  "gateway_nonce": "gateway-generated-nonce",
  "expires_at_unix_ms": 1770000000000,
  "signature": "base64url-signature"
}
```

URL Gateway pairing requires an out-of-band pairing code configured by the
Gateway operator. Managed SSH/SSH container Gateway pairing is accepted only on
the Desktop bridge transport started by `redeven-gateway service-start`;
spoofing bridge headers on a URL `serve` endpoint is not sufficient.

### Complete

`POST /gateway/v1/pairing/complete`

```json
{
  "protocol_version": "redeven-gateway-v1",
  "client_nonce": "desktop-generated-nonce",
  "gateway_nonce": "gateway-generated-nonce",
  "gateway_id": "gw_bastion",
  "binding_audience": "https://gateway.example.internal",
  "client_key_id": "client-key-id",
  "client_capability": "env_profile_write",
  "proof": "base64url-client-signature"
}
```

Response:

```json
{
  "protocol_version": "redeven-gateway-v1",
  "gateway_id": "gw_bastion",
  "client_key_id": "client-key-id",
  "paired_at_unix_ms": 1770000001000,
  "proof": "base64url-gateway-signature"
}
```

Challenge and proof signatures must cover protocol version, both nonces,
`gateway_id`, `binding_audience`, expiry, optional pairing code, optional client
capability, and the relevant public key identity. Challenges are single-use and
short-lived. Gateway service maintains a replay cache for nonces.

Interoperability details:

- Signing algorithm: Ed25519.
- Public key encoding: PEM SPKI.
- Private key encoding: PEM PKCS8 when stored by Desktop secure storage.
- Fingerprint format: `SHA256:<base64url(sha256(public_key_pem))>`.
- Client key id format: `gck_<first 24 chars of base64url(sha256(client_public_key_pem))>`.
- Canonical signing payload: UTF-8 JSON with object keys sorted
  lexicographically at every object level, no insignificant whitespace.
- `protocol_version` is required on all Gateway protocol requests and must be
  exactly `redeven-gateway-v1`.

## Authenticated Calls

After pairing, catalog and open-session calls are authenticated with request
metadata:

```text
x-redeven-gateway-id
x-redeven-client-key-id
x-redeven-client-nonce
x-redeven-request-ts
x-redeven-request-signature
```

The request signature covers protocol version, method, request body digest,
`gateway_id`, binding audience, nonce, and timestamp. Responses are signed by
Gateway service or returned over an already authenticated bridge transport.
Desktop verifies the pinned gateway fingerprint and request correlation before
using the response.

## Catalog

`POST /gateway/v1/catalog`

Request:

```json
{
  "protocol_version": "redeven-gateway-v1"
}
```

Response:

```json
{
  "protocol_version": "redeven-gateway-v1",
  "gateway": {
    "gateway_id": "gw_bastion",
    "display_name": "Bastion Gateway",
    "status": "online",
    "capabilities": [
      "env_catalog",
      "env_open_session",
      "terminal",
      "files"
    ]
  },
  "environments": [
    {
      "gateway_env_id": "env_finance_dashboard",
      "display_name": "Finance Dashboard",
      "env_kind": "reachable_env",
      "state": "available",
      "capabilities": [
        "open",
        "terminal"
      ],
      "access_capabilities": [
        "open",
        "terminal"
      ],
      "control_capabilities": [],
      "profile": {
        "managed": true,
        "access_route_kind": "url"
      },
      "origin": {
        "kind": "network_target",
        "label": "10.20.0.18"
      },
      "last_seen_at_unix_ms": 1770000000000
    }
  ]
}
```

`gateway_env_id` is scoped to the Gateway. Desktop row identity is
`gateway:${gateway_id}:env:${gateway_env_id}`. Same-name environments from
Local, Provider, and Gateway sources are displayed separately.

`access_capabilities` and `control_capabilities` are the authority for Desktop
actions. The aggregate `capabilities` field is derived for presentation only;
Desktop must not infer access or lifecycle control from old single-field
catalogs.

## Open Session

`POST /gateway/v1/open-session`

Request:

```json
{
  "protocol_version": "redeven-gateway-v1",
  "gateway_env_id": "env_finance_dashboard",
  "requested_capability": "env_app",
  "client_nonce": "desktop-generated-nonce",
  "bridge_session_id": "bridge_123",
  "route_id": "route_123"
}
```

`bridge_session_id` and `route_id` are required only when Desktop carries the
request over the desktop bridge transport. URL transports omit them and receive a
`local_direct_artifact`; bridge transports include them in the signed request
body and receive a matching `desktop_bridge_artifact`.

Response:

```json
{
  "protocol_version": "redeven-gateway-v1",
  "gateway_session_id": "gws_123",
  "gateway_env_id": "env_finance_dashboard",
  "connect_artifact": {
    "kind": "desktop_bridge_artifact",
    "bridge_session_id": "bridge_123",
    "route_id": "route_123",
    "expires_at_unix_ms": 1770000060000,
    "artifact_nonce": "artifact-nonce",
    "proof": "base64url-gateway-signature"
  },
  "diagnostics_hint": {
    "gateway_env_id": "env_finance_dashboard",
    "connection_kind": "gateway_ssh_host"
  }
}
```

`requested_capability` values are:

- `env_app`
- `terminal`
- `files`
- `web_service`
- `port_forward`

Connect artifact kinds are:

- `local_direct_artifact`: contains `url`, `expires_at_unix_ms`,
  `artifact_nonce`, and `proof`.
- `desktop_bridge_artifact`: contains `bridge_session_id`, `route_id`,
  `expires_at_unix_ms`, `artifact_nonce`, and `proof`.

`proof` covers `gateway_id`, `gateway_env_id`, `gateway_session_id`, artifact
kind, URL or route identity, TTL, nonce, requested capability, and binding
audience.

## Error Envelope

Gateway errors use a stable envelope:

```json
{
  "code": "INVALID_REQUEST",
  "message": "gateway_env_id is required.",
  "retryable": false,
  "redacted_detail": "optional diagnostic summary"
}
```

Known codes:

- `INVALID_REQUEST`
- `UNAUTHORIZED`
- `TRUST_CHANGED`
- `NOT_FOUND`
- `CAPABILITY_UNSUPPORTED`
- `UNAVAILABLE`
- `NOT_IMPLEMENTED`

Error messages and diagnostics must not include Desktop access tokens, refresh
tokens, provider credentials, runtime-control bearer values, grants, E2EE PSKs,
pairing secrets, request signatures, or private keys.

## URL Gateway Rules

- Default scheme is `https`.
- Loopback `http` is allowed only for explicit local development mode.
- Pairing secrets never appear in URL, query string, import config, logs, or
  diagnostics.
- TLS verification failures do not fall back to plaintext or unpaired mode.

## SSH And Container Gateway Rules

SSH host and SSH container transports carry the same protocol over the existing
Desktop bridge. They do not expose remote Runtime control URLs to renderer code,
and they do not upload Desktop login, Provider, or runtime-control credentials
to the remote host or container.
