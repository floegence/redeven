---
type: Architecture Boundary
title: ReDevPlugin Redeven adapters
tags: [architecture, plugins, adapters, ui]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Redeven binds authenticated sessions, source policy, business capabilities and placement to released ReDevPlugin. Platform alone owns protocol/trust/execution/state. Adapter faults stop at product boundary without implicit grants, copied platform state or substitute lifecycle.

# Contract

## Host modules and external packages
Redeven constructs the released Host with explicit core, official-release, runtime, connectivity, secrets, capability, and external-package modules. Redeven supplies session, authorization, web-security, trust, official release-source, observability, secret, external source, and business adapters; it never edits registry, inspection, token, lease, revoke-epoch, or plugin-data state directly.

The official signed-release module remains the stricter release-ref path.

## Network adapter

The product-owned hostnetwork package implements current host routing without
network I/O in its constructor. HTTP_PROXY, HTTPS_PROXY and ALL_PROXY use explicit
upper/lowercase environment settings, including explicit empty values for direct
routing; NO_PROXY is evaluated with the standard hostname/IP/CIDR matcher. On
macOS, requests without applicable environment policy use CFNetwork system
settings and bounded cancellable PAC resolution. Linux uses environment proxies
or normal OS routing. Remote Runtimes use their own host network environment.

The adapter respects the ordered configured routes. A bodyless GET/HEAD may try
the next configured route only after a dial failure before an application
connection exists. It never invents a direct fallback. TLS, protocol and unknown
outcome errors do not change routes. Writes use fresh HTTP/1 connections and are
not automatically replayed, including when the application supplies an idempotency
header. Read and write requests share a bounded eight-request limit per transport;
read pools retain at most two idle connections per origin for thirty seconds.

Market services own their default transport. The plugin integration closes its
caller-owned package transport on failure or shutdown. Each granted connector
receives an independent transport managed by the upstream pool lifecycle. TLS
verification and system trust roots remain enabled; proxy credentials stay on the
proxy hop and never become origin or plugin credentials.

## Reviewed connections

Connection inventory requires effective read access. Review, approval, cancellation
and revocation require an authenticated administrator with effective read, write
and execute access. The private-network adapter checks the exact cached session
and explicit nonempty prefixes using the published destination classifier;
metadata endpoints, unspecified addresses and blanket prefixes stay denied.
Upstream owns exact destination binding, address pinning, revisions, expiry,
leases and revocation. Installing a package grants no connection authority.

Plugin Center presents verified installed connector declarations, a separate
review and approval, exact destination/methods/private prefixes/secret reference,
and both connection and review expiry. Owner, active package, revision or policy
changes retire pending UI state. An uncertain approval is never replayed; the
client lists current authority before enabling another write. Failed reconciliation
keeps mutations disabled until an explicit successful refresh.

The connectivity executor retains the released 1 MiB request/response defaults.
Large application transfers require explicitly designed bounded requests; the
qualification fixture transfers 64 MiB as 64 one-MiB requests per direction and
also requires oversized requests and responses to fail. It does not certify a
single 64 MiB HTTP request or relax platform quotas.

## Surfaces and interaction ownership
The product Shell owns one released `PluginPlatformClient`, authenticated transport, and shared surface scope.

The application-method receiver (`surface.methods`) uses the same read authorization as opening and preparing its surface. The receiver registers, polls, and responds only within the platform-validated surface, gateway token, bridge channel, and frame generation. Registering a receiver grants no document write access: each intent invocation still passes its declared method effect, local policy, schema, and confirmation checks.

Redeven uses them for host placement behavior, never as identity, authorization, or permission evidence.

A recovery presentation may explain or retry the Host snapshot, but it is not a second open gate and owns no catch-up identity state machine.

## Web origin adapter

Redeven derives a plugin origin only from a trusted product entry origin and the released surface origin key. Local UI and AppServer route child requests to the released Web surface handler after removing parent credentials. Desktop, Gateway and Center own the product transport and origin routing; package assets, tickets and surface bridge semantics remain upstream-owned.

Ordinary HTTP loopback Local UI uses the same isolated resource handler as
Desktop. Its child authority must derive from a current public loopback parent
on the exact listener port. This is a resource route, not an additional public
management authority or a private-bridge fallback.

# Boundaries

These adapters map product identity and presentation into released ReDevPlugin APIs. Package and runtime ownership remains in [ReDevPlugin host integration boundary](redevplugin-boundary.md) and [Plugin package and runtime lifecycle](redevplugin-package-lifecycle.md).

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:240` - Source.
- `redeven:internal/redevpluginintegration/trust_adapter.go:1` - Source.
