---
type: Architecture Boundary
title: ReDevPlugin Redeven adapters
tags: [architecture, plugins, adapters, ui]
lifecycle: contract
reviewed_at: "2026-11-05"
---
# Summary

Redeven binds authenticated sessions, source policy, business capabilities and placement to released ReDevPlugin. Platform alone owns protocol/package integrity/execution/state. Adapter faults stop at product boundary without implicit grants, copied platform state or substitute lifecycle.

# Contract

## Host modules
Construct the released Host with Core, Runtime, IO, Web, Connectivity, Secrets, Process, Background and ExternalPackage modules. Product adapters supply authenticated identity, policy and resources. All sources share package inspection and durable installation; platform state stays opaque.

## Network
hostnetwork constructs without I/O. Explicit HTTP_PROXY/HTTPS_PROXY/ALL_PROXY either case,including empty/direct,plus standard NO_PROXY hostname/IP/CIDR. Otherwise macOS uses CFNetwork/bounded cancellable PAC,Linux normal OS routing;remote Runtime its own environment. Preserve configured route order. Only bodyless GET/HEAD may advance after pre-connection dial failure;no invented direct fallback,TLS/protocol/unknown retry or write replay even with idempotency header. Writes use freshHTTP1;transport cap8requests/read pool2idle per origin/30s.

Market owns default transport;integration closes caller-owned package transport on failure/shutdown. Connector transports independently follow upstream pool lifecycle. Keep TLS/system roots;proxy credentials stay proxy-hop only.

## Reviewed connections
Inventory requires effective Read;review/approve/cancel/revoke authenticated admin+RWX. Exact cached session/nonempty private prefixes pass published destination classifier;deny metadata/unspecified/blanket prefixes. Upstream binds address/destination/revision/expiry/lease/revoke;install grants no connection.

Review installed destinations, methods, prefixes, secret references and expiry. Owner/package/revision/policy changes retire pending UI. Unknown approval requires authoritative refresh before further writes. Close awaits cancellation and fences late replies. Market failure cannot suppress reconciliation. The 64MiB fixture uses 64 one-MiB requests per direction; released per-request quotas still apply.

## Surfaces and origins
One Shell PluginPlatformClient/authenticated transport/shared scope owns placement. surface.methods receiver uses opening Read authority and registers/polls/responds only within validated surface/gateway/bridge/frame generation. Each intent still checks effect/policy/schema/confirmation;receiver grants no write authority. Placement/recovery cannot become identity,permission or second opening/catchup gate.

Derive origins only from trusted product entry and released origin key. Local UI/AppServer strip parent credentials before released handler;Desktop/Gateway/Center route product transport. Platform owns assets/tickets/bridge. Ordinary HTTP loopback uses same isolated handler with exact current public parent/listener port,not management authority/private-bridge fallback.

# Boundaries

[Host boundary](redevplugin-boundary.md) and [lifecycle](redevplugin-package-lifecycle.md) define package/runtime ownership.

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:240` - Source.
- `redeven:internal/redevpluginintegration/session_adapter.go` - Source.
