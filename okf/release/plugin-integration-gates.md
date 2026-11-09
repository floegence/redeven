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

November 8, 2026, macOS ARM64 evidence (source-specific, no live generation):

- `3620d5f1ab84` plus locks/notices, ReDevPlugin3.24.1/Floe0.101.1: four native retained-state runs (three concurrent with author restart) pass installed identity,real sandbox/WASM,inspected update,restart,re-enable,history,uninstall and cleanup. `/tmp/plugin-readiness-desktop-final/report.json`, `/tmp/plugin-readiness-parallel-storage-{1,2,3}/report.json`.
- Author restart exposed first-read404 despite ready Flower/intact IndexedDB. `/tmp/plugin-readiness-cdp-9.log` and deterministic local-router test reproduce pre-registration admission. Activation barrier now waits identity/access registration independently of plugin readiness; earlier successes do not qualify repair.
- Rebuilt digest `sha256:0c686369cb687274e3d034e15142fb25d4551c2bd04035a6f13aac54775c1529`: both lanes plus five author repeats pass/zero owned processes. `/tmp/plugin-activation-fixed-{storage,author}/report.json`, `/tmp/plugin-activation-fixed-repeat-{1,2,3,4,5}/report.json`. Removing barrier reproduces404; Agent/Local UI/access-proxy full tests pass.
- Explicitly authorized offline profile relocation moved nine opaque entries with matching fingerprints,55 unchanged link targets/inodes and unchanged config. Repeated apply/startup passed. `/tmp/plugin-profile-recovery/{migration,native}.json`: explicitly selected local Environment retains three installed plugins,two author records,dedicated origin,original workspace and inventory after restart; clean processes. First probe selected remote Environment and remains failed evidence. No compatibility reader.
- Rebase onto local main214c0b839, rebuilt1a3b8aec6fed with signed helper/published dependencies: runtime digest `sha256:aea2853261533db7d9f2c98e550c0c28dd9b538775bab15babfd1548628d4b7e`. `/tmp/plugin-rebased-native-{storage,author}/report.json` passes retention,Worker/update/re-enable/restart/history/latest text and cleanup. Integrated Settings/session changes only; no live generation or unrecovered-profile certification.

Runner: `scripts/check_plugin_integration.sh`. Git history retains complete prior run details and adverse attempts.
