# RCPP v2 Protocol Specification

> RCPP v2 is the fixed public contract between Redeven Provider authority, Redeven access points, Redeven Desktop, and Redeven Runtime.
>
> Runtime and Desktop implementation references:
>
> - Desktop provider client: `desktop/src/main/controlPlaneProviderClient.ts`
> - Desktop provider catalog types: `desktop/src/shared/controlPlaneProvider.ts`
> - Runtime bootstrap exchange: `internal/config/bootstrap.go`
> - Runtime provider link binding: `internal/agent/provider_link.go`
> - OpenAPI: `spec/openapi/rcpp-v2.yaml`

## 1. Scope

RCPP v2 defines one provider authority and many access points:

- `provider_origin` is the unified authorization surface, for example `https://provider.example` or `https://redeven.test`.
- `access_point_origin` is the Region entrypoint that serves environment listing, open-session, runtime bootstrap, and direct control channel.
- Desktop authorizes once against the provider authority, discovers all active access points, and syncs every access point.
- Runtime connects only to the access point for the selected environment.

RCPP v2 intentionally does not define capability negotiation, v1 compatibility, provider-side device inventory, or browser application transport after the encrypted session is established.

## 2. Versioning

- `protocol_version` is fixed to `rcpp-v2`.
- Providers are compatible with `rcpp-v2` or they are not.
- Cross-service JSON fields are `snake_case`.
- `provider_id` for first-party Redeven is `redeven`.

## 3. Browser Bridge

Provider authority must serve a browser page at:

- `GET /desktop/connect`

The page has two modes:

1. Launch mode
   - Browser initiates `redeven://control-plane/connect?provider_origin=...`.
2. Authorization mode
   - Desktop opens `/desktop/connect?desktop_state=...&code_challenge=...&code_challenge_method=S256`.
   - Browser uses the signed-in provider session to request `POST /api/rcpp/v2/desktop/authorize`.
   - Browser deep-links back to Desktop with `redeven://control-plane/authorized?...&authorization_code=...`.

The browser never receives the PKCE verifier and never deep-links a bearer token.

## 4. Provider Authority Endpoints

All endpoints in this section are served on `provider_origin`.

### 4.1 Discovery

- `GET /.well-known/redeven-provider.json`

Returns `DiscoveryResponse`:

- `protocol_version`
- `provider_id`
- `display_name`
- `provider_origin`
- `documentation_url`
- `access_points[]`

Each `access_points[]` entry contains `access_point_id`, `region`, `display_name`, `access_point_origin`, `status`, and optional location/health fields.

### 4.2 Desktop Authorization

- `POST /api/rcpp/v2/desktop/authorize`
- Auth: same-origin browser session

Request: `DesktopAuthorizationRequest`

Response: `DesktopAuthorizationResponse`

The authorization code is short-lived, one-time, and bound to `provider_origin` plus the PKCE challenge.

### 4.3 Desktop Connect Exchange

- `POST /api/rcpp/v2/desktop/connect/exchange`

Request: `DesktopConnectExchangeRequest`

Response: `DesktopConnectExchangeResponse`

Returns:

- `access_token`
- `refresh_token`
- account summary
- `provider_id`
- `provider_origin`
- `access_points[]`

It does not return environments. Desktop must list environments from access points.

### 4.4 Refresh / Revoke / Me

- `POST /api/rcpp/v2/desktop/token/refresh`
- `POST /api/rcpp/v2/desktop/token/revoke`
- `GET /api/rcpp/v2/me`

Refresh and revoke use refresh tokens. `me` uses `Authorization: Bearer <desktop_access_token>`.

## 5. Access Point Endpoints

All endpoints in this section are served on `access_point_origin`.

### 5.1 Environments

- `GET /api/rcpp/v2/environments`
- Auth: `Authorization: Bearer <desktop_access_token>`

Returns only environments for the current access point. Each environment includes:

- `env_public_id`
- `region`
- `access_point_id`
- `access_point_origin`
- display/status fields
- optional `runtime_health`

### 5.2 Runtime Health

- `POST /api/rcpp/v2/environments/runtime-health/query`
- Auth: `Authorization: Bearer <desktop_access_token>`

Returns per-environment runtime health. Removed or invisible environments are returned as per-item offline health with `offline_reason_code=environment_removed`.

### 5.3 Desktop Open Session

- `POST /api/rcpp/v2/environments/:envId/desktop/open-session`
- Auth: `Authorization: Bearer <desktop_access_token>`

Returns `DesktopOpenSessionResponse` with:

- `access_point_origin`
- optional `bootstrap_ticket`
- optional `remote_session_url`
- `expires_at_unix_ms`

The `bootstrap_ticket` is bound to `provider_origin`, `access_point_id`, user, and environment.

### 5.4 Runtime Bootstrap Exchange

- `POST /api/rcpp/v2/runtime/bootstrap/exchange`
- Auth: `Authorization: Bearer <bootstrap_ticket>`

Request includes:

- `env_public_id`
- `provider_origin`
- `local_environment_public_id`
- `agent_instance_id`
- host/runtime metadata

The access point validates:

- ticket provider origin equals request `provider_origin`
- ticket access point equals current access point
- environment is active and belongs to the current access point
- user can bind runtime for the namespace

Response includes `provider_id`, `provider_origin`, `access_point_id`, `access_point_origin`, direct control-channel credentials, and Local Environment binding metadata.

## 6. Desktop Merge Rules

Desktop stores a single provider authorization per `provider_origin + provider_id`.

Provider environment stable ID:

```text
provider:<encoded_provider_origin>:env:<encoded_env_public_id>
```

`access_point_origin` is not part of the stable environment ID, but it is required routing metadata. Open-session, runtime health, and provider-link checks must use the environment record's access point origin.

## 7. Runtime Config Rules

Runtime config stores:

- `provider_origin`: unified provider authority
- `controlplane_provider_id`: `redeven`
- `controlplane_base_url`: access point origin
- `environment_id`
- `local_environment_public_id`
- direct control-channel info

`controlplane_base_url` is therefore an access point URL in RCPP v2.
