---
type: Architecture Contract
title: Plugin market consumption
description: Discover one verified latest release per plugin channel while GitHub Releases and ReDevPlugin retain artifact and trust authority.
tags: [architecture, plugins, market, release]
timestamp: 2026-08-01T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven reads a public, latest-only catalog from `https://plugins.redeven.com`,
refreshes and atomically publishes a validated snapshot without restarting the
Desktop, and serves that snapshot only to the trusted Env App origin. The market identifies a candidate GitHub Release; it
does not host plugin packages, preserve version history, grant trust, or install
anything. Redeven downloads the exact GitHub assets declared by the snapshot and
passes the complete signed release transport to released ReDevPlugin `v3.0.36`.
An invalid current response fails closed. A valid last-known-good snapshot may
keep discovery available as stale data, but it cannot authorize an automatic
update.

# Contract

## Snapshot lifecycle
Startup reads only an already validated local last-known-good snapshot and does not wait for the public market.

Catalog pages are fetched in order and each visible entry must carry its complete validated `install_preview`; Redeven does not fan out a second `/latest` request per plugin or keep a fallback path for incomplete catalog entries.

A mismatch uses the generic placeholder, so a later market generation cannot replace older installed author copy or substitute different icon bytes.

## Latest-only discovery
The snapshot contains at most one current release for each plugin and channel.

Availability `disabled` or `revoked` is a discovery and action constraint, while ReDevPlugin revocation evidence remains the installation and runtime authority.

## Download and verification boundary
The market never supplies package bytes from Cloudflare storage.

Installation and update still require the normal product review and ReDevPlugin lifecycle rules; installation does not grant permissions or enable runtime access.

# Boundaries

- The market owns reviewed latest-release metadata and Cloudflare publication. - GitHub Releases owns immutable package and signed trust-document transport. - Redeven owns the one background refresh controller, last-known-good caching,   trusted-origin projection, product presentation, and product-pinned official   anchors. - ReDevPlugin owns remote download, cryptographic verification, durable install   Executions and Events, update, rollback, revocation, registry state,   permissions, and runtime lifecycle. - Market or cache failure must not remove installed plugins or prevent Redeven   startup, and must not become permission to install unverified content.

# Evidence

- `redeven:internal/pluginmarket/service.go` - Separates remote refresh from validated local snapshot reads and consumes catalog install previews without `/latest` fan-out.

- `redeven:internal/pluginmarket/contracts.go` - Validates generation, GitHub release identity, hashes, anchors, and complete release transport.

- `redeven:internal/redevpluginintegration/market_refresh.go` - Owns startup and periodic scheduling, backoff, single-flight joining, generation acceptance, and status subscriptions.
