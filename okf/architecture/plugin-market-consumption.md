---
type: Architecture Contract
title: Plugin market consumption
description: Discover one verified latest release per plugin channel while GitHub Releases and ReDevPlugin retain artifact and trust authority.
tags: [architecture, plugins, market, release]
timestamp: 2026-08-01T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Redeven atomically refreshes the validated latest-only catalog from `https://plugins.redeven.com` and exposes it only to trusted Env App. Market metadata identifies GitHub Releases; it neither hosts packages nor grants trust or installs. Exact declared assets enter released ReDevPlugin verification. Invalid responses fail closed; validated last-known-good data may support stale discovery, never automatic updates.

# Contract

- Startup reads validated local cache without waiting for market. Fetch pages in order; every entry needs complete `install_preview`, with no per-plugin `/latest` fan-out or incomplete-entry fallback.
- Keep one current release per plugin/channel. Disabled/revoked market entries constrain discovery/actions; upstream revocation evidence owns install/runtime admission.
- Installed author/icon presentation must match its generation/identity; mismatches use a generic placeholder rather than newer copy/bytes.
- Packages and signed trust transport come from GitHub Releases, never market Cloudflare storage. Installation/update requires normal product review and platform lifecycle; installation grants no permission/runtime access.

# Boundaries

Market owns reviewed metadata/publication. Redeven owns refresh, validated cache, trusted projection and official anchors. ReDevPlugin owns download, cryptographic trust, durable Executions/Events, install/update/rollback, revocation, registry, permissions and runtime. Market failure cannot remove installed plugins, block startup or authorize unverified content.

# Evidence

- `redeven:internal/pluginmarket/service.go` - Separates remote refresh from validated local snapshot reads and consumes catalog install previews without `/latest` fan-out.

- `redeven:internal/pluginmarket/contracts.go` - Validates generation, GitHub release identity, hashes, anchors, and complete release transport.
