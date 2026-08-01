---
type: Architecture Contract
title: Plugin market consumption
description: Discover one verified latest release per plugin channel while GitHub Releases and ReDevPlugin retain artifact and trust authority.
tags: [architecture, plugins, market, release]
timestamp: 2026-08-01T00:00:00Z
---
# Summary

Redeven reads a public, latest-only catalog from `https://plugins.redeven.com`, freezes
one validated snapshot during startup, and serves that snapshot only to the
trusted Env App origin. The market identifies a candidate GitHub Release; it
does not host plugin packages, preserve version history, grant trust, or install
anything. Redeven downloads the exact GitHub assets declared by the snapshot and
passes the complete signed release transport to released ReDevPlugin `0.6.23`.
An invalid current response fails closed. A valid last-known-good snapshot may
keep discovery available as stale data, but it cannot authorize an automatic
update.

# Contract

## Snapshot lifecycle

Startup requests the stable catalog and each visible plugin's exact latest
release from the configured HTTPS market origin. Responses use strict JSON
decoding, bounded bodies, stable generation checks, duplicate rejection, and
schema validation. Every page and latest response must name the same non-stale
generation. The resulting snapshot is sorted, timestamped, written atomically
to the product cache, and then frozen for the process lifetime.

If refresh fails because the market is offline, Redeven may load only a
previously persisted snapshot that still passes the current schema and release
transport validation. It marks that snapshot `stale` with source `cache` and
preserves its original `cached_at`. Unknown fields, malformed identities,
incomplete transport, or a response that changes generation during pagination
are invalid input, not offline fallback. If neither remote nor cache is valid,
Redeven still starts; Plugin Center keeps installed plugins usable and reports
that discovery and release installation are unavailable until restart.

AppServer exposes the frozen snapshot at
`/_redeven_proxy/api/plugins/market/catalog`. The route requires read
permission and an Env App route. Codespace, port-forward, plugin, missing, and
untrusted origins receive no market data. The endpoint does not perform a new
network request or let the browser choose an origin, generation, or release.

## Latest-only discovery

The snapshot contains at most one current release for each plugin and channel.
It carries the plugin presentation fields, availability state, compatibility,
immutable GitHub repository/release/tag/commit/asset identity, SHA-256 values,
signer identity, signed publisher release reference, root and signing-ledger
pins, and the complete locator-to-asset transport projection. Redeven does not
persist or expose a market version-history model.

Plugin Center projects the current Containers entry from the frozen snapshot;
the version is not compiled into the production catalog. An unavailable market
does not hide installed instances. Availability `disabled` or `revoked` is a
discovery and action constraint, while ReDevPlugin revocation evidence remains
the installation and runtime authority.

## Download and verification boundary

The market never supplies package bytes from Cloudflare storage. For a selected
release, Redeven converts the already validated snapshot into the exact
`PluginReleaseRef` and released remote-transport asset set. ReDevPlugin downloads
those HTTPS GitHub Release assets with its bounded transport, verifies every
locator, size, digest, root delegation, source policy, revocation document,
signing-ledger proof, signed release metadata, package signature, package hashes,
publisher, plugin, version, channel, and host capability requirement, and only
then changes registry state.

Market `latest`, signer labels, compatibility text, and listing status are not
installation authorization. Redeven pins the official root and signing-ledger
public keys in the product, rejects a snapshot whose advertised anchors differ,
and delegates package-signing verification to ReDevPlugin. The browser cannot
replace GitHub URLs, hashes, or trust documents. Installation and update still
require the normal product review and ReDevPlugin lifecycle rules; installation
does not grant permissions or enable runtime access.

# Boundaries

- The market owns reviewed latest-release metadata and Cloudflare publication.
- GitHub Releases owns immutable package and signed trust-document transport.
- Redeven owns startup refresh, last-known-good caching, trusted-origin
  projection, product presentation, and product-pinned official anchors.
- ReDevPlugin owns remote download, cryptographic verification, installation,
  update, rollback, revocation, registry state, permissions, and runtime
  lifecycle.
- Market or cache failure must not remove installed plugins or prevent Redeven
  startup, and must not become permission to install unverified content.

# Evidence

- `redeven:internal/pluginmarket/service.go` - Fetches, validates, freezes, and atomically caches one latest-only market snapshot.
- `redeven:internal/pluginmarket/contracts.go` - Validates generation, GitHub release identity, hashes, anchors, and complete release transport.
- `redeven:internal/codeapp/codeapp.go` - Refreshes once at startup and keeps market failure non-fatal.
- `redeven:internal/codeapp/appserver/server.go` - Serves only the frozen snapshot through the read-gated Env App route.
- `redeven:internal/redevpluginintegration/release_module.go` - Converts validated market data into released remote release transport.
- `redeven:internal/envapp/ui_src/src/ui/plugins/officialPluginCatalog.ts` - Projects current official discovery from the frozen snapshot.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginApi.ts` - Preserves installed inventory and reports market unavailability.
