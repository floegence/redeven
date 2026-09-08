---
type: Architecture Contract
title: Plugin market consumption
description: Discover one verified latest release per plugin channel while GitHub Releases and ReDevPlugin retain artifact and trust authority.
tags: [architecture, plugins, market, release]
timestamp: 2026-08-01T00:00:00Z
---
# Summary

Redeven reads a public, latest-only catalog from `https://plugins.redeven.com`,
refreshes and atomically publishes a validated snapshot without restarting the
Desktop, and serves that snapshot only to the trusted Env App origin. The market identifies a candidate GitHub Release; it
does not host plugin packages, preserve version history, grant trust, or install
anything. Redeven downloads the exact GitHub assets declared by the snapshot and
passes the complete signed release transport to released ReDevPlugin `v3.0.29`.
An invalid current response fails closed. A valid last-known-good snapshot may
keep discovery available as stale data, but it cannot authorize an automatic
update.

# Contract

## Snapshot lifecycle

Startup reads only an already validated local last-known-good snapshot and does
not wait for the public market. One Integration-owned controller immediately
refreshes the stable catalog, then refreshes every ten minutes with up to one
minute of random jitter. Failures retry after 15 seconds, 30 seconds, one
minute, two minutes, and then five minutes until recovery; success resets that
backoff. Automatic refresh, manual refresh, and update review join the same
in-flight task. Runtime shutdown cancels its timer, request, waiters, and status
subscribers.

Redeven sends its exact product and ReDevPlugin SemVer values so the market
excludes incompatible releases before discovery. Catalog pages are fetched in
order and each visible entry must carry its complete validated
`install_preview`; Redeven does not fan out a second `/latest` request per
plugin or keep a fallback path for incomplete catalog entries. Responses use
strict JSON decoding, bounded bodies, stable generation checks, duplicate
rejection, and schema validation. Every page must name the same non-stale
generation. The resulting snapshot is sorted, timestamped, written atomically
to the product cache, and atomically replaces the current in-process snapshot.
An older generation is rejected before it can replace memory, cache, or release
authority; an equal generation may update its check time.

Remote refresh and cached reads are separate operations. At startup Redeven may
load only a previously persisted snapshot that still passes the current schema
and release transport validation. It marks that snapshot `stale` with source
`cache` and preserves its original `cached_at`. A failed remote refresh leaves
the accepted memory and cache snapshot unchanged. Unknown fields, malformed
identities, incomplete transport, or a response that changes generation during
pagination are invalid input, not an alternate fetch or cache-selection path.
If neither remote nor cache is valid, Redeven still starts; Plugin Center keeps
installed plugins usable and reports that discovery and release installation
are unavailable until the controller succeeds.

AppServer separates local reads, explicit refresh, and notification:

- `GET /_redeven_proxy/api/plugins/market/catalog` returns only the accepted
  in-memory or startup LKG snapshot and never performs remote I/O.
- `POST /_redeven_proxy/api/plugins/market/catalog/refresh` joins the
  controller's one in-flight remote task and waits for a fresh result.
- `GET /_redeven_proxy/api/plugins/market/catalog/events?after_seq=...` streams
  the latest `refreshing`, `ready`, or `refresh_failed` state. Events carry only
  a process-local sequence, generation, staleness, check time, and next refresh
  time; they never expose transport errors.

All three routes require read permission and an Env App route. Codespace,
port-forward, plugin, missing, and untrusted origins receive no market data.
Each SSE subscriber retains only the newest event and is released on disconnect
or Integration shutdown. A stale cache remains display-only evidence: it cannot
prove that a user-initiated update check used the latest official release. The
browser cannot choose an origin, remote cadence, generation, or release.

Catalog and detail responses use the in-place `/v1` presentation contract.
Catalog carries every compact locale record; selecting a plugin may load the
full `/v1/plugins/{plugin_id}` presentation. Redeven resolves requested BCP 47
languages through the released ReDevPlugin resolver, using RFC 4647 lookup and
the author default locale without an English-specific fallback. Author text is
plain text with the resolved `lang` and `dir="auto"`; it is never copied into
host code or declaration metadata. The local detail proxy preserves the
market's validated `meta.generation` separately from author detail data; the
Plugin Center accepts and caches a detail only when that generation matches the
catalog snapshot generation. Missing, stale, or negative detail generations
fail closed rather than allowing cross-generation presentation mixing.

The Env App reads the local catalog and opens the market status stream as soon
as the authenticated plugin session is ready; discovery does not depend on
opening Plugin Center. A `ready` event for a higher generation reloads the local
snapshot and refreshes Host inventory once. Stream delivery and a simultaneous
manual refresh are serialized by owner and generation, so they cannot trigger
duplicate inventory reads. Owner replacement or page destruction aborts the old
snapshot request and subscription. The browser does not poll the public market.

Plugin Center renders the current inventory immediately. User refresh and
official update review POST to the explicit refresh route with a 20-second UI
deadline, covering the controller's 15-second remote deadline. Official update
review opens immediately, waits for a fresh catalog, relocates the exact
inventory key, and only then inspects the current release source. Background
failure keeps a usable LKG catalog visible; no usable catalog exposes one retry
action. Neither path reports a stale source as current or as `no update`.
Installation review reads the selected entry's cached
`install_preview` in one request; it never prefetches packages or Host inspection
evidence. The preview is keyed by plugin instance, market generation, exact
release reference, and its four binding digests. A generation or release change
invalidates the preview and asks the user to refresh. Confirmation submits the
same exact preview once with an idempotent request id. A lost response reattaches
to that Execution; no second detail, download, or inspection request is made.
Closing the dialog hides it while the task remains active in the card or task
area.

The market may expose one compact icon descriptor for the current verified
release. Its URL, media type, dimensions, and digest are evidence-bound to the
same manifest and presentation generation as the catalog entry; the market
does not proxy package bytes. Installed inventory remains authoritative for an
installed version. Redeven may reuse the complete current presentation when
the installed version, package hash, manifest hash, and entries hash exactly
match the current signed release. For an older installed release, Redeven may
reuse only the bounded icon URL when the installed manifest's icon path selects
a Host-verified package entry whose digest and media type exactly match the
market icon descriptor. A mismatch uses the generic placeholder, so a later
market generation cannot replace older installed author copy or substitute
different icon bytes.

## Latest-only discovery

The snapshot contains at most one current release for each plugin and channel.
It carries compact manifest-derived presentation locales, availability state, compatibility,
immutable GitHub repository/release/tag/commit/asset identity, SHA-256 values,
signer identity, signed publisher release reference, Ed25519 root pin, and the
complete locator-to-asset transport projection. Redeven does not
persist or expose a market version-history model.

Plugin Center projects current entries from the current validated snapshot; names,
summaries, keywords, and long descriptions are not compiled into the production
catalog. Redeven owns the product category projection: market `utilities` or
`weather` entries appear under the stable Utilities category, while the signed
author presentation remains unchanged. An unavailable market
does not hide installed instances. Availability `disabled` or `revoked` is a
discovery and action constraint, while ReDevPlugin revocation evidence remains
the installation and runtime authority.

## Download and verification boundary

The market never supplies package bytes from Cloudflare storage. For a selected
release, Redeven converts the already validated snapshot into the exact
`PluginReleaseRef` and released remote-transport asset set. ReDevPlugin downloads
those HTTPS GitHub Release assets with its bounded transport, verifies every
locator, size, digest, root delegation, source policy, revocation document,
signed release metadata, package signature, package hashes,
publisher, plugin, version, channel, and host capability requirement, and only
then changes registry state.

Redeven constructs the released official-release Host module even when startup
has no usable market snapshot, so a temporary market outage does not remove a
platform feature. Each accepted remote or last-known-good snapshot atomically
replaces the provider's complete multi-plugin release map before that snapshot
is published to product readers. Removed releases become unresolvable, and a
partial or invalid replacement leaves the prior complete binding unchanged.

Official installation is a durable ReDevPlugin Execution. Redeven submits the
snapshot-derived release reference and four preview digests with an idempotent
request identity and observes ordered Events; it does not treat the market response, browser
connection, or an Env App pending flag as installation authority. A failed or
disconnected observer may reattach to the same Execution without selecting new
assets or replaying the mutation. If submission response delivery is unknown,
Redeven preserves and replays the same request id and preview digests so the
Host recovers the existing operation before attempting any evidence claim.

The Execution performs `download`, `verify`, `install`, and `enable` in that order.
It downloads the package, validates trust and hashes, parses the final manifest,
checks capability contracts and declaration digests, resolves conflicts and
history-data recovery, commits enabled state, and activates the plugin. Detailed
substeps remain diagnostics; the UI depends only on those four stable stages.

Market `latest`, signer labels, compatibility text, and listing status are not
installation authorization. Redeven pins the official Ed25519 root public key in
the product, rejects a snapshot whose advertised anchor differs,
and delegates package-signing verification to ReDevPlugin. The browser cannot
replace GitHub URLs, hashes, or trust documents. Installation and update still
require the normal product review and ReDevPlugin lifecycle rules; installation
does not grant permissions or enable runtime access.

# Boundaries

- The market owns reviewed latest-release metadata and Cloudflare publication.
- GitHub Releases owns immutable package and signed trust-document transport.
- Redeven owns the one background refresh controller, last-known-good caching,
  trusted-origin projection, product presentation, and product-pinned official
  anchors.
- ReDevPlugin owns remote download, cryptographic verification, durable install
  Executions and Events, update, rollback, revocation, registry state,
  permissions, and runtime lifecycle.
- Market or cache failure must not remove installed plugins or prevent Redeven
  startup, and must not become permission to install unverified content.

# Evidence

- `redeven:internal/pluginmarket/service.go` - Separates remote refresh from validated local snapshot reads and consumes catalog install previews without `/latest` fan-out.
- `redeven:internal/pluginmarket/contracts.go` - Validates generation, GitHub release identity, hashes, anchors, and complete release transport.
- `redeven:internal/redevpluginintegration/market_refresh.go` - Owns startup and periodic scheduling, backoff, single-flight joining, generation acceptance, and status subscriptions.
- `redeven:internal/codeapp/codeapp.go` - Wires the controller into the private AppServer while keeping market failure non-fatal.
- `redeven:internal/codeapp/appserver/server.go` - Separates read-only catalog GET and explicit refresh POST behind Env App authorization.
- `redeven:internal/codeapp/appserver/plugin_market_events.go` - Projects bounded process-local refresh state over authenticated SSE.
- `redeven:internal/envapp/ui_src/src/ui/plugins/officialPluginCatalog.ts` - Projects current official discovery from the validated snapshot.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginApi.ts` - Separates cached reads, explicit refresh, and SSE parsing while preserving installed inventory.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Subscribes per authenticated plugin owner and deduplicates inventory refreshes by generation.
