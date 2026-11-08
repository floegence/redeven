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

The existing author-restart lane separately verifies composer/draft continuity and retained terminal state. On failure it preserves the visible readiness diagnostics and isolated Runtime stderr before owned cleanup, so a hidden composer cannot be mistaken for lost draft data. Both lanes are explicit acceptance, not additions to the pre-push gate.

# Boundaries

The main CI and release gate owns validation ordering and exact-main provenance. This concept owns only integration behavior and its focused renderer/Desktop evidence; it does not create a second package parser, release manifest, or transport implementation.

# Evidence

- November 8, 2026: the macOS ARM64 development bundle built from `3620d5f1ab84` plus synchronized npm locks/notices consumed ReDevPlugin 3.24.1 and Floe 0.101.1. Native retained-state qualification passed four runs, including three concurrent with author-restart qualification: exact installed identity, real sandbox/WASM execution, inspected update, restart, UI re-enable, author-history access, uninstall and owned cleanup. Reports are `/tmp/plugin-readiness-desktop-final/report.json` and `/tmp/plugin-readiness-parallel-storage-{1,2,3}/report.json`.
- Author-restart qualification exposed intermittent first-read HTTP 404 responses while Flower was ready and the IndexedDB draft remained intact. Native debugger evidence (`/tmp/plugin-readiness-cdp-9.log`) located the failure in readiness HTTP; the deterministic local-router regression reproduced the same 404 before product session registration. The host activation barrier now delays management requests until identity/access registration, independently of plugin admission. Earlier passing repetitions do not certify this correction; use rebuilt native evidence. No live model generation was exercised.
- The rebuilt activation-fix bundle has runtime-files digest `sha256:0c686369cb687274e3d034e15142fb25d4551c2bd04035a6f13aac54775c1529`. Retained-state lifecycle and author-restart both passed, followed by five additional author-restart runs; every report confirms zero remaining owned processes. Evidence: `/tmp/plugin-activation-fixed-{storage,author}/report.json` and `/tmp/plugin-activation-fixed-repeat-{1,2,3,4,5}/report.json`. The actual local router regression fails with HTTP 404 when the barrier is removed and passes with it. Full Agent, Local UI and access-proxy package tests also passed.
- The inspected user development profile still contains legacy plugin placement and dependency-tree symlinks rejected by the offline relocation invariant. Its data and running session were left untouched; isolated qualification does not certify recovery of this profile.
- After rebasing onto local main `214c0b839`, the complete Desktop bundle was rebuilt from `1a3b8aec6fed` with the signed desktop-access helper and published dependencies. Its runtime-files digest is `sha256:aea2853261533db7d9f2c98e550c0c28dd9b538775bab15babfd1548628d4b7e`. Both native lanes passed again, including exact-package retention, worker execution, inspected update, disable/re-enable, restart, author history and latest composer text; owned-process cleanup passed. Reports: `/tmp/plugin-rebased-native-{storage,author}/report.json`. This verifies the integrated Settings and local-session changes; it still does not certify live model generation or the unrecovered user profile.
- `redeven:scripts/check_plugin_integration.sh:1` - Tests.
