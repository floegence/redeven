---
type: Gateway Contract
title: Gateway access sessions
description: Select Direct URL or Gateway proxy access and preserve Runtime authentication, transport identity, and revocation.
tags: [gateway, desktop, access, security, sessions]
timestamp: 2026-10-02T00:00:00Z
---
# Summary

Gateway publishes authorized Environment profiles and optionally forwards access.
`direct_url` uses the Desktop network; `gateway_proxy` uses the Gateway network.
The selected mode is explicit and never changes after failure. Runtime remains
the authority for login, MFA, business sessions, and logout. Gateway grants no
private Runtime management authority. A proxy lease ends on expiry, explicit
close, profile update/deletion, or Gateway shutdown; reopening requires a new
authorized lease. Direct access retains Runtime's independent login lifetime.

# Contract

## Access selection and identity

URL profiles publish `open_direct` and `open_via_gateway`; Gateway metadata
publishes `env_direct_open` and `env_proxy_open`. Catalog availability describes
publication, not Runtime health. New URL profiles default to Gateway proxy.
Existing version-1 profiles migrate atomically to version 2 with Direct URL,
preserving IDs, names, endpoints, timestamps, and SSH/container coordinates.
Unsupported, malformed, or uncommittable state stays unchanged and blocks writes.
SSH Host and SSH Container profile kinds remain configuration/catalog entries
without an opening capability. They never borrow Desktop Runtime privileges.

Desktop keeps `gateway_environment` identity for both modes. Direct mode uses
the existing public Local UI probe and URL transport in a dedicated partition.
Proxy mode creates a signed access lease, establishes its local transport,
probes through that transport, and opens the Runtime Env App. The probe cannot
switch to an advertised Runtime address or another network path. Reuse requires
the same Gateway, Environment, endpoint and mode, plus a live proxy lease.
Cancellation closes local transports and attempts remote revocation.

## Fixed Gateway entry and isolated transport

Gateway uses its existing HTTP/HTTPS listener at
`/gateway/v3/access/<token>/`; it creates no per-session listening port. Tokens
contain 256 cryptographically random bits and are never renderer data, logs,
diagnostic text, or copied addresses. A signed artifact binds Gateway identity,
Environment, requested `env_app` capability, client nonce, session identity,
expiry, and endpoint. The server records the authenticated client owner.

The ordinary access handler streams HTTP, WebSocket and SSE. Each session owns
a Cookie jar; client Cookie and internal proxy headers are removed, upstream
Set-Cookie remains in the jar, and cross-origin redirects are rejected. Origin
and Referer are translated to the fixed target. Runtime authentication failures
pass through unchanged, distinct from Gateway session failures.

Desktop additionally uses the reserved `_tunnel` WebSocket endpoint as a binary
byte stream to the single stored profile host and port. It accepts no dial
address from the client. An authenticated per-session listener on `127.0.0.1`
provides an HTTP/CONNECT proxy, configured on an isolated Electron partition.
The renderer navigates to the original Runtime URL; all traffic to it passes
through Gateway. There is no DIRECT proxy rule or automatic route fallback.
Other destinations are rejected. A managed Gateway carries the same access path
over its existing `gateway_protocol` bridge surface, retaining
`desktop_bridge_artifact` and `gateway_bridge` identities.

Preserving the original origin and HTTPS is intentional: Runtime secure-session
artifacts bind Host/Origin, and MFA requires the original HTTPS context. HTML
rewriting through an HTTP loopback document would invalidate those contracts.
On the Desktop byte-stream path, Runtime cookies belong to the isolated Electron
partition, not the Gateway Cookie jar. Gateway cannot inspect Runtime TLS
credentials on that path. No TLS interception, certificate bypass, or content
rewriting is needed. Native CodeSpace and Web Service adapters use the same
selected connection owner. Binary data, compression, redirects, WebSocket,
streaming requests, and Runtime absolute root paths retain their original
semantics. HTTP access and the Desktop byte-stream path intentionally have
separate authentication storage and must not be mixed in one browser session.

## Lease and error boundary

Proxy artifacts have a ten-minute lease. Gateway timers revoke active streams
without depending on Desktop exit. `close-session` requires a signed request
from the owning paired client and is idempotent; unknown and other-client IDs
do not reveal ownership. Profile mutation revokes existing proxy leases.
Gateway shutdown ends all sessions, and a restart cannot recover old tokens.

Desktop closes every local connection and listener with its session. Remote
revocation failure is recorded with nonsecret IDs and never blocks window
closure. An open proxy window receives distinct Gateway unavailable, target
unavailable, or session-expired recovery state. It can return to the connection
center and explicitly reopen. Runtime login/MFA and Runtime session expiry stay
inside Runtime's access gate. A failed proxy open may offer Direct URL, and a
failed direct open may offer Gateway proxy, only as explicit second actions.

Deleting a published profile removes future Gateway access. It cannot revoke
an independently authenticated Runtime session reached through a known direct
URL; Runtime owns that authorization. Desktop ends its profile-bound view when
it learns through deletion or a catalog refresh that its profile was removed
or the endpoint changed. A managed service start requires an explicit user
action, and retries retain the selected access mode. Direct Runtime registrations and their
lifecycle controls remain independent throughout.

# Boundaries

Targets must be HTTP/HTTPS URLs without embedded credentials. Default policy
rejects localhost, loopback, private networks, and special-use destinations.
Explicit private-network opt-in does not grant loopback access. Every new dial
resolves DNS, validates the selected IP, and dials that IP rather than resolving
again. HTTPS retains certificate and hostname validation. The target-only
tunnel follows the same dial policy.

Pairing authorizes metadata/catalog reads and opening published targets.
Profile writes additionally require `env_profile_write` consent and
`--enable-profile-write`, identically for URL and managed bridge transports.
No access artifact grants Runtime installation, lifecycle, configuration,
password, or MFA-management privileges. Audit events contain Gateway,
Environment, session IDs and error classes; they exclude tokens, Cookie,
passwords, MFA values, proofs and complete signed requests.

# Evidence

- `redeven:internal/gatewayservice/access.go` - Fixed access handler, Cookie jar boundary and target-bound byte stream.
- `redeven:internal/gatewayservice/access_test.go` - Authentication isolation, WebSocket, streaming, binary, revocation and target policy.
- `redeven:internal/runtimegateway/envprofiles/migration_test.go` - Preserved profile fields and read-only migration failures.
- `redeven:desktop/src/main/gatewayEnvironmentAccess.ts` - Explicit access owner, typed artifacts, scoped probing and cleanup.
- `redeven:desktop/src/main/gatewayProxyTransport.test.ts` - Real proxy transport, destination restriction, streaming and secret isolation.
- `redeven:desktop/src/main/gatewayStore.test.ts` - Preserved paired Gateway configuration and atomic migration failures.
- `redeven:internal/localui/gateway_access_browser_test.go` - Production Runtime, Gateway and Electron login, MFA, WSS, files, terminal and Flower stream qualification.
- `redeven:desktop/scripts/check-gateway-access-ui.mjs` - Real Desktop components across ten locales, explicit routes, keyboard actions and narrow dark layouts.
- `redeven:spec/openapi/gateway-v3.yaml` - Wire capabilities, access modes, artifacts and close-session contract.

The opt-in Electron qualification uses production public Runtime and Gateway
handlers on an isolated test state directory, with a fixture certificate pinned
only in the test browser. Its Node readiness transport also verifies rejection
of the untrusted certificate. The transport unit fixture uses an unresolvable
Desktop target hostname while Gateway reaches the fixture over TCP. These
checks verify routing independence. The separate
[deployment qualification](gateway-deployment-qualification.md) exercises real
TCP isolation and the maintained HTTPS Nginx configuration, including idle lease
expiry and log redaction. Physical firewall appliances are not required for that
network contract. Cross-platform installed packages remain release qualification.
