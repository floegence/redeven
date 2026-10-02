---
type: Validation Guide
title: Gateway deployment qualification
description: Verify an isolated Runtime behind an HTTPS reverse proxy and distinguish source acceptance from installer release checks.
tags: [gateway, desktop, validation, networking, security]
timestamp: 2026-10-02T00:00:00Z
---
# Summary

This guide owns deployment acceptance for [Gateway access sessions](gateway-access-sessions.md).
The required network condition is that Desktop cannot dial Runtime directly but
can reach it through Gateway. A local isolated deployment can establish that
condition without a physical firewall appliance. Qualify the supported HTTPS
reverse-proxy configuration once for affected changes; do not add this suite to
ordinary push CI or the bounded main gate. Installer qualification remains with
the existing release workflow and cannot be inferred from this source fixture.

# Contract

## One reproducible local deployment

Build the current Env App and Code App assets and install Desktop's frozen
dependencies, then run `bash scripts/check_gateway_deployment.sh`. Prerequisites
are the repository Go/Node versions, the pinned Electron runtime, Docker, Nginx
with HTTPS support, and OpenSSL. Dependencies must come from published releases.

The runner creates a unique Docker bridge and starts the current production
Gateway and Runtime handlers from the shared Local UI test fixture. Only
Gateway's listener is published, on a host loopback port. Runtime HTTP/HTTPS and
the separate transport fixture remain on real private container IP addresses.
The runner rejects a topology in which the host can dial those addresses; a
synthetic DNS failure does not count. Docker Desktop on macOS provides the
host/VM isolation used by this method. A Linux Docker host that can route
directly to its bridge requires a separately isolated client environment before
this suite can qualify it; the script never changes host firewall rules.

An independent host Nginx terminates HTTPS in front of the published Gateway
listener. Electron runs on the host and uses the production Gateway client,
pairing, signed session artifact, and session proxy. The child process trusts
only its temporary Gateway certificate in addition to its normal roots. The
Runtime fixture certificate is pinned only in the test browser; the production
Node readiness transport must still reject that untrusted Runtime certificate.
No host trust store, global Nginx service, or existing container is modified.

The same runner verifies:

- Failed direct TCP access to each Runtime target, followed by successful
  password/MFA authentication, secure cookies, reload and logout via Gateway.
- Independent Runtime cookie stores, production Flowersec WSS, file listing,
  terminal creation, and Flower's workspace event stream.
- The original HTTPS Gateway origin in signed artifacts; 3 MiB binary requests,
  absolute redirects, and immediate SSE delivery over both the Desktop tunnel
  and ordinary Gateway HTTP forwarding.
- Idle streams lasting beyond sixty seconds and ending at the actual production
  ten-minute Gateway lease, followed by rejected token reuse.
- Profile deletion, idempotent session closure, and Gateway shutdown with no
  direct-network fallback.
- Useful Nginx success/failure status without tokens, request paths, cookies,
  passwords, or signed request bodies in its logs.

Outputs live in `desktop/dist/gateway-deployment-acceptance/`: the case report,
deployment identity, scoped logs, and cleanup outcome. Preserve useful reports
outside a temporary worktree before deleting it. A run is accepted only when its
report passes and its owned processes, container, network and temporary secrets
are cleaned up. The suite takes at least ten minutes because it observes the
real lease rather than changing production timing for a test.

## Supported reverse-proxy configuration

`assets/gateway/nginx.conf.template` is the maintained standalone example and the
exact configuration rendered by the qualification runner. Replace every named
placeholder with the deployment's listener, server name, certificate/key paths,
private Gateway upstream, PID path and safe access-log path. Keep the Gateway
upstream private and expose only the intended HTTPS listener.

The configuration preserves signed Gateway headers and the external Host,
forwards WebSocket Upgrade, disables request/response buffering, and permits
large request bodies. Its 660-second upstream idle timeout exceeds Gateway's
ten-minute lease. The access log contains only time, method, status, byte count
and duration. Nginx error logging is disabled because its request context cannot
reliably redact opaque tokens from URIs; use the safe status log and Gateway
audit events for diagnosis. Do not enable URI/body/header tracing in front of
the access endpoint. Readiness, Runtime authentication and permission rules are
owned by the access-session contract, not by the reverse proxy.

# Boundaries

This qualification establishes the network and proxy behavior of the tested
configuration. It does not certify every firewall vendor, reverse-proxy product,
VPN, TLS inspection appliance, or network policy. A physical firewall is not a
mandatory product test unless a particular supported deployment requires it.

The Linux fixture executes production Go handlers with a test Runtime, not an
installed release binary. Terminal creation and transport are covered; native
terminal rendering, product installers, signatures, notarization, updates and
uninstallation are separate release concerns. Keep the existing macOS/Linux
amd64/arm64 package and installer gates in `.github/workflows/release.yml`.
For release-candidate Gateway smoke checks, use the installed Desktop to launch,
pair, open the proxy environment, establish a terminal connection and close the
session; do not repeat all source tests on every platform or expand ordinary CI.

# Evidence

- `redeven:desktop/scripts/check-gateway-deployment.mjs` - Owned Docker/Nginx topology, real TCP isolation, fixture-scoped TLS trust and cleanup.
- `redeven:desktop/scripts/fixtures/gateway-deployment.ts` - Binary/SSE/redirect, idle lease, shutdown and redacted-log assertions.
- `redeven:internal/localui/gateway_access_browser_test.go` - Shared production Runtime/Gateway server fixture and private deployment mode.
- `redeven:assets/gateway/nginx.conf.template` - Executed HTTPS reverse-proxy configuration.
- `redeven:.github/workflows/release.yml` - Published target matrix and installer verification ownership.
