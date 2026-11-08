---
type: Release Contract
title: Plugin integration gate
tags: [release, plugin, integration, ui]
lifecycle: contract
reviewed_at: "2026-11-08"
---
# Summary

Plugin gate checks released ReDevPlugin Host/market against Redeven authority, placement, renderer and Desktop lifecycle. Use published packages/isolated profiles; copied platform paths, implicit grants, second bridges and stale projections fail instead of fabricating integration.

# Contract

The focused plugin gate covers:

- Host construction, authenticated owner/session mapping, direct authorization,   explicit origin/CSRF/action policy, and stable observability; - market release install/update and exact publisher/plugin/instance identity,   market preview digests, stable progress, and no duplicate package parser; - public HTTPS URL, GitHub Release, and local `.redevplugin`   inspect-confirm-install admission, process-local TTL inspection identity,   strict source provenance, exact owner/session/bytes/hash revalidation,   enabled install state with no implicit grants, permission-attention handling   for missing access, and no durable receipt/query lifecycle; - runtime path/target/hash, ProcessManager health, persistent lease replay, and   Host storage/network/Event services; - canonical AppServer route reservation/delegation and Local UI access checks; - generated UI lifecycle DTOs, management revisions, production Plugin entry,   generic permission requirements, exact inventory-key selection, full external   security and source-provenance review, exact generic permission ids, FIFO   confirmation, and close-before-placement lifecycle; - Shell-root multi-window Activity chrome, standard `redeven.plugin` Workbench   persistence, released interaction ownership, exact-surface close   reconciliation, and cross-placement serialization; - static absence of legacy proxy/bootstrap/base64 package and copied platform   paths.

Mock containers do not satisfy this check.

## Native retained-state qualification

`desktop/scripts/check-plugin-storage-recovery.mjs` requires an explicit verified Desktop bundle. Published owner APIs seed an isolated legacy installation and author workspace. The native lane reproduces unavailable admission, stops the isolated Runtime, relocates opaque bytes, verifies exact package/instance retention, executes a real WASM worker through the dedicated-origin sandbox, commits an inspected update and repeats execution after restart. Creation history remains reachable over the live plugin window. Its report records bundle identity, assertions and owned-process cleanup. A passed synthetic seed does not certify an arbitrary user profile: inspect its actual relocation inputs, including dependency links and conflicting targets. Never report that profile recovered without applying and verifying its supported transaction.

The existing author-restart lane separately verifies composer/draft continuity and retained terminal state. Both lanes are explicit acceptance, not additions to the pre-push gate.

# Boundaries

The main CI and release gate owns validation ordering and exact-main provenance. This concept owns only integration behavior and its focused renderer/Desktop evidence; it does not create a second package parser, release manifest, or transport implementation.

# Evidence

- `redeven:scripts/check_plugin_integration.sh:1` - Tests.
