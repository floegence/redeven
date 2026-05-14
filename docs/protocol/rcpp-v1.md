# RCPP v1 Protocol Specification

> RCPP v1 is the stable public contract that a compatible control plane provider exposes to Redeven Desktop and Redeven Runtime.

## 1. Scope

RCPP v1 defines:

- provider discovery
- browser-assisted Desktop authorization using PKCE
- Desktop authorization exchange
- provider account and environment queries
- provider Environment Desktop open sessions
- runtime bootstrap exchange and Local Environment binding

RCPP v1 intentionally does **not** define:

- provider capability negotiation
- device inventory resources
- host-specific feature flags
- browser-side application transport after the encrypted session is established

The contract is environment-first. Users and Desktop UI see environments, not a separate device inventory resource. Runtime bootstrap still carries `local_environment_public_id` as an internal Local Environment identity stored inside the current OS user / Redeven profile state root; it is not provider device inventory and must not be exposed as a managed product object.

A provider must treat `provider_id + user_public_id + local_environment_public_id` as one current environment link at a time. A physical device can host multiple OS users or multiple Redeven profiles because each profile owns its own runtime state and therefore its own `local_environment_public_id`.

## 2. Versioning And Compatibility

- `protocol_version` is fixed to `rcpp-v1`.
- Desktop treats the protocol surface as fixed-path and fixed-shape.
- Providers are either compatible with `rcpp-v1` or they are not.
- New provider behavior must not depend on capability negotiation.
- Cross-service JSON must stay `snake_case`.
- Contract fields must remain semantically aligned between the provider implementation, Desktop client, and runtime bootstrap consumer.

## 3. Browser Bridge Contract

RCPP v1 includes an HTTP API surface and one required browser bridge page:

- browser bridge page: `GET /desktop/connect`

This page is not part of OpenAPI because it is a browser-facing launch surface rather than a JSON API, but it is still part of the public provider contract.

The bridge page has two modes:

1. Launch mode
   - browser initiates `redeven://control-plane/connect?provider_origin=...`
   - no bearer credential is included in the deep link
2. Authorization mode
   - Desktop opens `/desktop/connect?desktop_state=...&code_challenge=...&code_challenge_method=S256`
   - browser uses the signed-in session to request `POST /api/rcpp/v1/desktop/authorize`
   - browser deep-links back to Desktop with `authorization_code`

Rules:

- Desktop generates `state`, `code_verifier`, and `code_challenge`.
- browser never receives the PKCE verifier.
- browser deep links must not contain a bearer token that can directly mint long-lived Desktop authorization.

## 4. Discovery Document

- `GET /.well-known/redeven-provider.json`

Purpose:

- identify the provider
- declare the protocol version
- point Desktop and users at public documentation

Required response fields:

- `protocol_version`
- `provider_id`
- `display_name`
- `provider_origin`
- `documentation_url`

Rules:

- `provider_id` is the canonical provider identity across Desktop catalogs and provider bindings.
- `provider_id` is **not** the same thing as the local Desktop/runtime `provider_key`.
- `documentation_url` should point to a stable public document, not a source-code implementation detail.

## 5. HTTP Endpoints

### 5.1 Desktop Browser Authorization

- `POST /api/rcpp/v1/desktop/authorize`

Auth:

- same-origin browser request
- authenticated user session

Request:

- `DesktopAuthorizationRequest`

Response:

- `DesktopAuthorizationResponse`

Semantics:

- browser exchanges the current web session for a short-lived Desktop `authorization_code`.
- provider binds the authorization code to:
  - `provider_origin`
  - `code_challenge`
  - `code_challenge_method`
- `authorization_code` is short-lived and one-time.

### 5.2 Desktop Connect Exchange

- `POST /api/rcpp/v1/desktop/connect/exchange`

Request:

- `DesktopConnectExchangeRequest`

Response:

- `DesktopConnectExchangeResponse`

Semantics:

- Desktop exchanges `authorization_code + code_verifier` for:
  - short-lived `desktop_access_token`
  - long-lived revocable `desktop_refresh_token`
  - account summary
  - visible environment list
- provider validates PKCE before minting saved Desktop authorization.

### 5.3 Desktop Token Refresh

- `POST /api/rcpp/v1/desktop/token/refresh`

Request:

- `DesktopTokenRefreshRequest`

Response:

- `DesktopTokenRefreshResponse`

### 5.4 Desktop Token Revoke

- `POST /api/rcpp/v1/desktop/token/revoke`

Request:

- `DesktopTokenRevokeRequest`

Response:

- `204 No Content`

### 5.5 Provider Me

- `GET /api/rcpp/v1/me`

Auth:

- `Authorization: Bearer <desktop_access_token>`

Response:

- `ProviderMeResponse`

### 5.6 Provider Environments

- `GET /api/rcpp/v1/environments`

Auth:

- `Authorization: Bearer <desktop_access_token>`

Response:

- `ProviderEnvironmentListResponse`

Semantics:

- each environment row includes a stable `environment_url` generated by the provider.
- Desktop uses that URL directly for copy/display instead of guessing from `provider_origin + env_public_id`.
- each environment row may include an initial `runtime_health` snapshot for immediate launcher rendering.

### 5.7 Provider Runtime Health Query

- `POST /api/rcpp/v1/environments/runtime-health/query`

Auth:

- `Authorization: Bearer <desktop_access_token>`

Request:

- `ProviderEnvironmentRuntimeHealthQueryRequest`

Response:

- `ProviderEnvironmentRuntimeHealthQueryResponse`

Semantics:

- Desktop uses this endpoint for welcome-page and environment-library runtime refreshes.
- providers should support batch lookup for requested `env_public_id` values in one request.
- `GET /environments` remains the provider catalog response; runtime liveness refresh belongs to this endpoint.

### 5.8 Provider Environment Desktop Open Session

- `POST /api/rcpp/v1/environments/:envId/desktop/open-session`

Auth:

- `Authorization: Bearer <desktop_access_token>`

Response:

- `DesktopOpenEnvironmentResponse`

Semantics:

- Desktop asks for the current open-session materials of one environment.
- provider may return:
  - a one-time provider-link bootstrap ticket
  - remote desktop session material
  - or both
- Desktop may use `remote_session_url` to open the provider Environment remotely.
- Desktop may use `bootstrap_ticket` only for an explicit provider-local connect flow. The Welcome `Open` action must not silently consume the ticket to link a Local Runtime.

### 5.9 Provider Link / Runtime Bootstrap Exchange

- `POST /api/rcpp/v1/runtime/bootstrap/exchange`

Auth:

- `Authorization: Bearer <bootstrap_ticket>`

Request:

- `RuntimeBootstrapExchangeRequest`

Response:

- `RuntimeBootstrapExchangeResponse`

Semantics:

- runtime exchanges a one-time provider-link bootstrap ticket for direct control-channel connection info.
- request includes `env_public_id`, `local_environment_public_id`, `agent_instance_id`, and optional host/runtime metadata.
- response includes `direct` plus `local_environment_binding`.
- `local_environment_binding.generation` must be persisted by the runtime and echoed in later control-channel register/renewal flows.
- exchanging a new ticket for the same user and `local_environment_public_id` links that user's Local Environment to the new environment; the provider must clear stale binding fields for the previous environment, rotate that environment's direct control-channel credentials, and disconnect its stale control channel.
- Desktop may deliver the ticket to a running Local Runtime through a desktop-only runtime-control endpoint. Providers do not need a separate protocol branch for startup bootstrap versus hot provider link; the ticket semantics are identical.
- credential renewal must only advance the generation for the currently matched environment link; it must never create or restore a stale environment binding.

## 6. Data Model Summary

Runtime bootstrap Local Environment binding fields:

- `RuntimeBootstrapExchangeRequest.env_public_id`: target environment selected by the user.
- `RuntimeBootstrapExchangeRequest.local_environment_public_id`: stable internal runtime identity for the current user's Local Environment profile. This is scoped to the current OS user / Redeven profile state root and is not a user-visible device inventory resource.
- `RuntimeBootstrapExchangeRequest.agent_instance_id`: current runtime installation/process identity.
- `RuntimeBootstrapExchangeResponse.direct`: direct control-channel credentials.
- `RuntimeBootstrapExchangeResponse.local_environment_binding`: provider-confirmed Local Environment link, including `generation`.

Important objects:

- `DiscoveryResponse`
- `DesktopAuthorizationRequest`
- `DesktopAuthorizationResponse`
- `DesktopConnectExchangeRequest`
- `DesktopConnectExchangeResponse`
- `DesktopOpenSessionResponse`
- `DesktopTokenRefreshRequest`
- `DesktopTokenRefreshResponse`
- `DesktopTokenRevokeRequest`
- `ProviderMeResponse`
- `ProviderEnvironmentSummary`
- `ProviderEnvironmentListResponse`
- `ProviderEnvironmentRuntimeHealth`
- `ProviderEnvironmentRuntimeHealthQueryRequest`
- `ProviderEnvironmentRuntimeHealthQueryResponse`
- `RuntimeDirectConnectInfo`
- `RuntimeBootstrapExchangeRequest`
- `RuntimeBootstrapExchangeResponse`
- `ProviderLocalEnvironmentBinding`

Provider implementations commonly persist Desktop authorization grants with:

- public grant identifier
- user identifier
- provider origin
- refresh token hash
- status
- expiration timestamp
- last-used timestamp
- revocation timestamp

The exact storage schema is provider-owned as long as the protocol semantics remain intact.

## 7. Error Model

Success responses on the RCPP JSON API return the contract object directly.

Failure responses use the standard Redeven error envelope:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_DESKTOP_ACCESS",
    "message": "Invalid desktop access token"
  }
}
```

Representative error codes:

- `INVALID_REQUEST`
- `INVALID_DESKTOP_AUTHORIZATION_CODE`
- `INVALID_DESKTOP_ACCESS`
- `INVALID_DESKTOP_AUTHORIZATION`
- `INVALID_BOOTSTRAP_TICKET`
- `ENVIRONMENT_NOT_FOUND`
- `ENVIRONMENT_INACTIVE`
- `EXTERNAL_ORIGIN_UNAVAILABLE`
- `TOKEN_SERVICE_UNAVAILABLE`
- `PROVIDER_ENVIRONMENTS_UNAVAILABLE`

## 8. Token Semantics

### 8.1 `authorization_code`

- one-time
- short TTL
- bound to `provider_origin`
- bound to `code_challenge`
- exchanged only with `code_verifier`

### 8.2 `desktop_access_token`

- short TTL
- memory-only in Desktop
- bound to `provider_origin`
- bound to authorization grant identity

### 8.3 `desktop_refresh_token`

- long TTL
- revocable
- stored in Desktop secret storage only
- provider validates it against the current authorization grant state

### 8.4 `bootstrap_ticket`

- one-time
- short TTL
- bound to `provider_origin`
- bound to `env_public_id`
- exchanged once to link the current user's Local Environment to that environment
- safe to use either during an explicit bootstrap exchange or during an explicit Desktop runtime-control provider-link command
- not a renderer credential and not a signal that Desktop should auto-link on `Open`

## 9. Sequence Flows

### 9.1 Add Control Plane In Desktop

1. Desktop calls discovery.
2. Desktop opens the provider browser bridge page.
3. browser launches Desktop without any bearer handoff.
4. Desktop generates `state + code_verifier + code_challenge`.
5. Desktop reopens the provider bridge page with the PKCE challenge.
6. browser requests `desktop/authorize`.
7. browser deep-links back to Desktop with `authorization_code`.
8. Desktop exchanges `authorization_code + code_verifier`.
9. Desktop syncs provider environments into the shared environment catalog.

### 9.2 Open Environment From A Browser Page To Desktop

1. control plane browser page deep-links Desktop with `provider_origin + env_public_id`.
2. if Desktop already has active provider authorization, it directly requests `desktop/open-session`.
3. otherwise Desktop runs the same PKCE authorization flow as section 9.1.
4. after connect exchange succeeds, Desktop requests `desktop/open-session`.
5. Desktop decides whether to:
   - open `remote_session_url`
   - or, only after an explicit user `Connect Local Runtime` action, pass `bootstrap_ticket` to the running Local Runtime through runtime-control

### 9.3 Provider Link / Runtime Bootstrap Exchange

1. Desktop or provider flow obtains a one-time `bootstrap_ticket`.
2. runtime posts `runtime/bootstrap/exchange`. Desktop may trigger this in a running Desktop-managed runtime through runtime-control.
3. provider confirms the Local Environment link and returns direct control-channel connection info.
4. runtime connects to the provider control channel.

## 10. Implementation Guidance For Third-Party Providers

A compatible provider should:

- expose all fixed RCPP v1 endpoints exactly as specified
- expose a browser bridge page at `/desktop/connect`
- keep `documentation_url` stable and publicly reachable
- avoid HTML fallback responses on JSON endpoints
- distinguish browser-session auth from Desktop bearer-token auth
- enforce one-time semantics for `authorization_code` and `bootstrap_ticket`
- bind Desktop authorization material to `provider_origin`
- validate PKCE with `S256`
- keep environment visibility and access decisions server-authoritative
- keep `local_environment_public_id` as an internal binding identity only; do not create a provider-side device-management surface from it

## 11. OpenAPI

Machine-readable contract:

- [`../openapi/rcpp-v1.yaml`](../openapi/rcpp-v1.yaml)

If this specification and the OpenAPI document diverge, treat this specification as the higher-level semantic source and update the OpenAPI document to match.
