---
type: Architecture Contract
title: Plugin market consumption
tags: [architecture, plugins, market, release]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Redeven atomically refreshes the validated latest-only catalog from `https://plugins.redeven.com` and exposes it only to trusted Env App. Market metadata identifies GitHub Releases; it neither hosts packages nor grants trust or installs. Exact declared assets enter released ReDevPlugin verification. Invalid responses fail closed; validated last-known-good data may support stale discovery, never automatic updates.

# Contract

- Startup reads validated local cache without waiting for market. Fetch pages in order; every entry needs complete `install_preview`, with no per-plugin `/latest` fan-out or incomplete-entry fallback.
- Keep one current release per plugin/channel. Disabled/revoked market entries constrain discovery/actions; upstream revocation evidence owns install/runtime admission.
- Installed author/icon presentation must match its generation/identity; mismatches use a generic placeholder rather than newer copy/bytes.
- Packages and signed trust transport come from GitHub Releases, never market Cloudflare storage. Installation/update requires normal product review and platform lifecycle; installation grants no permission/runtime access.

## Network behavior

The market client uses the same product network adapter as plugin package and
release-document downloads. It follows current environment/system proxy policy
and normal OS DNS/VPN routing. Startup remains cache-only; network errors affect
refresh, detail or icon requests without blocking Runtime or changing verified
installed state. The service releases only transports it creates; injected HTTP
clients remain caller-owned.

# Boundaries

Market owns reviewed metadata/publication. Redeven owns refresh, validated cache, trusted projection and official anchors. ReDevPlugin owns download, cryptographic trust, durable Executions/Events, install/update/rollback, revocation, registry, permissions and runtime. Market failure cannot remove installed plugins, block startup or authorize unverified content.

# Evidence

- `redeven:internal/pluginmarket/service.go` - Validated catalog reads/refresh and install previews without /latest fan-out.

- `redeven:internal/pluginmarket/contracts.go` - Catalog generation, immutable releases, hashes/anchors and complete transport.
