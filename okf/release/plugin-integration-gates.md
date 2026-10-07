---
type: Release Contract
title: Plugin integration gate
description: Qualify released ReDevPlugin Host, market, runtime, and UI integration on the exact main tip.
tags: [release, plugin, integration, ui]
timestamp: 2026-10-07T00:00:00Z
---
# Summary

The plugin integration gate proves that the released ReDevPlugin Host and market contracts remain aligned with Redeven's authorization, placement, renderer, and Desktop lifecycle adapters. It uses the published package and isolated smoke profiles; copied platform paths, implicit grants, second bridges, and stale lifecycle projections fail closed.

# Contract


The focused plugin gate covers:

- Host construction, authenticated owner/session mapping, direct authorization,
  explicit origin/CSRF/action policy, and stable observability;
- market release install/update and exact publisher/plugin/instance identity,
  market preview digests, stable progress, and no duplicate package parser;
- public HTTPS URL, GitHub Release, and local `.redevplugin`
  inspect-confirm-install admission, process-local TTL inspection identity,
  strict source provenance, exact owner/session/bytes/hash revalidation,
  enabled install state with no implicit grants, permission-attention handling
  for missing access, and no durable receipt/query lifecycle;
- runtime path/target/hash, ProcessManager health, persistent lease replay, and
  Host storage/network/Event services;
- canonical AppServer route reservation/delegation and Local UI access checks;
- generated UI lifecycle DTOs, management revisions, production Plugin entry,
  generic permission requirements, exact inventory-key selection, full external
  security and source-provenance review, exact generic permission ids, FIFO
  confirmation, and close-before-placement lifecycle;
- Shell-root multi-window Activity chrome, standard `redeven.plugin` Workbench
  persistence, released interaction ownership, exact-surface close
  reconciliation, and cross-placement serialization;
- static absence of legacy proxy/bootstrap/base64 package and copied platform
  paths.

The built renderer smoke requires the Plugins Activity entry, opens Plugin
Center, consumes the current validated market projection, and submits the exact signed
release-ref install command without opening an external package URL flow. It
still verifies zero implicit grants, canonical ReDevPlugin envelopes,
content-hashed JS/CSS, absence of the removed browser terminal WASM artifact,
non-blank root output, and zero console, page, request, or HTTP failures.
Offline projection keeps installed plugins visible
and reports one retryable catalog-unavailable state.

Browser-facing reads use the released POST query contract and retain exact
Origin, CSRF, action, and query-effect authorization. Session disconnect uses
the released durable four-hash fence and drain; Redeven awaits exact teardown
acknowledgement before deleting identity and reconciles retained fences on
restart.

Workbench plugin interaction and file export are releasable only through the `v3.0.33`
source/port-bound interaction ownership and exact-surface close contracts. The
gate rejects overlays, pointer-event switching, copied interaction DTOs, a
second bridge, session-wide close fallback, placement persistence before close,
local disposal presented as server revocation, or an export path that bypasses
the released action-window, payload, cancellation, and cleanup contracts.

Plugin opening changes also run `scripts/smoke_desktop_plugin_opening.mjs` with
an isolated Desktop smoke configuration and the published Weather and Mind Map
installed through Plugin Center. The runner uses the current checkout's
Playwright package and requires task-owned state, user-data, cache, temporary,
and report roots plus unique Local UI, CDP, and inspector ports. It removes only
its two test plugin placements before the opening scenarios. Invoke it as
`node scripts/smoke_desktop_plugin_opening.mjs /tmp/redeven-plugin-opening/config.json`.

Startup changes also run `scripts/smoke_desktop_plugin_startup.mjs` against the
same isolated profile with the two official plugins installed. Pass the profile
configuration, report filename label, and optional UI-open delay in milliseconds
(up to 10000). It restarts the real runtime, opens the saved canvas, and records
runtime readiness, actual SDK first commits, and the completed recovery response
with its request duration. Every installed test plugin must report `ready`.
Compare repeated process restarts separately from the first cache-fill run;
network-bound first installation is not an in-memory startup measurement.
Evidence records real first commits while hidden or offscreen, retained iframe
identities across mode and viewport changes, exact 35% and 100% zoom, restored
canvas allocation, plugin actions, a genuine default-deadline timeout, lost
single-surface close response reconciliation, and saved widget identity after
reload. Mock containers do not satisfy this check.


# Boundaries

The main CI and release gate owns validation ordering and exact-main provenance. The ReDevPlugin release artifact concept owns registry publication, native bytes, signatures, and package inventory. This concept owns only integration behavior and its focused renderer/Desktop evidence; it does not create a second package parser, release manifest, or transport implementation.

# Evidence

- `redeven:scripts/check_plugin_integration.sh:1` - Defines focused ReDevPlugin integration coverage.
- `redeven:internal/pluginmarket/service_test.go:1` - Proves strict market validation and last-known-good fallback.
- `redeven:internal/envapp/ui_src/scripts/checkPackagedRenderer.mjs:1` - Verifies the production Plugin entry and built renderer.
- `redeven:scripts/smoke_desktop_plugin_opening.mjs:1` - Exercises isolated plugin opening and surface placement.
- `redeven:scripts/smoke_desktop_plugin_startup.mjs:1` - Exercises startup, recovery, and retained plugin surface identity.
- `redeven:okf/architecture/plugin-platform-integration.md` - Defines released Host and surface ownership used by this gate.
