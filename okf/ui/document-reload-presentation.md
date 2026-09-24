---
type: UI Contract
title: Env App document reload presentation
description: Bridge document reload before modules execute and hand off once to the selected authorized inventory.
tags: [ui, desktop, startup, caching]
timestamp: 2026-09-23T00:00:00Z
---
# Summary

Published Floe owns the anonymous geometry placeholder spanning a full document
reload. Redeven's Shell owns its handoff to the selected Activity inventory.
Reload must not paint an empty root, reveal a differently shaped list skeleton,
or replace restored content with another loading state. Geometry is never
resource data or authorization. Explicit access denial, navigation, an actionable
error, or changed authentication ends the placeholder instead of hiding recovery.
Unavailable presentation storage must not prevent normal startup.

# Contract

## First paint

The HTML head installs Floe's independent `reload-placeholder` entry before
external application modules and styles. After an authorized Host Applications,
Web Services, Containers, Codespaces, or Files view becomes renderable, the Shell arms
capture of the visible shell on `pagehide`. Transient portals and dialogs outside
the shell are excluded. Capture retains only rectangles, resolved colors, corner
radii, and offsets of explicitly marked scroll containers. It never serializes
HTML, resource text, image sources, input values, URLs, or permission facts.

The record is bounded by the published contract and lives in this window's
`sessionStorage`, isolated by browser origin and the environment session key.
The `reload-layout-v2` key retires earlier captures that included Files content
shapes; old records are not restored. It does not use Desktop's synchronous preference IPC or replace the asynchronous
resource cache. Viewport or scope mismatch and malformed records use normal
startup. An absent record has a small static branded loading surface in HTML;
application mounting replaces it atomically. No resource count is invented in
this pre-module surface.

## One handoff

[Page loading continuity](page-loading-continuity.md) owns the shared page registry
used by Activity, Workbench, and reload eligibility.

The Shell restricts restored geometry to its main region once live navigation is
mounted. Inventory pages expose a presentation attribute derived from their
existing successful data, successful empty result, or error. They do not own a
second loading state or independently dismiss the document placeholder.

When current content is ready, Floe restores marked scroll offsets before
removing the placeholder. Surviving rows then follow the existing refresh
contract. During the handoff, neither module loading nor first-fetch loading can
expose an intermediate list skeleton. Fresh authoritative resource changes may
legitimately change the final layout. Ordinary reconnect and in-page refresh
never activate this document placeholder.

Navigation to another target, a display-mode change, environment or authentication
change, explicit locking or denial, connection recovery, and actionable module
or data errors dismiss the placeholder. Existing verification, error, and retry
interfaces remain usable. Navigation away while identity checks are pending
cannot be reversed by a late handoff. Only these five Activity pages opt in;
terminal, logs, monitoring, and embedded application contents are not captured.

Files captures workspace chrome only. Its tree, file list/grid, path and status
regions use published `data-floe-reload-omit` to exclude both surfaces and their
text/icon shapes, keeping those regions blank during reload. It never captures
directory entries, paths, names, file contents, or icons. Its session-only directory
cache is not persisted by this presentation contract. Its first directory response or explicit
failure completes the same Shell handoff.

Resource snapshots remain subject to
[Env App resource snapshots](env-resource-cache.md). No text or icon from those
snapshots appears before the existing permission and identity confirmation.
Activity target selection remains owned by
[Activity navigation restoration](activity-navigation-restoration.md).

# Boundaries

Remembered geometry conveys neither resource data nor authority. Access denial, authentication changes, navigation and actionable errors end the placeholder. Storage unavailability cannot prevent startup or conceal the recovery state.

# Evidence

- `redeven:internal/envapp/ui_src/index.html` - Static first-visit surface.
- `redeven:internal/envapp/ui_src/vite.config.ts` - Published early bootstrap injection.
- `redeven:internal/envapp/ui_src/src/ui/services/envReloadPresentation.ts` - Single Shell handoff and revocation boundaries.
- `redeven:internal/envapp/ui_src/src/ui/services/envReloadPresentation.test.ts` - Pending, successful empty, error, navigation, and identity transitions.
- `redeven:internal/envapp/ui_src/scripts/checkDocumentReload.mjs` - Compiled Shell reload with delayed modules, permission, scope, and data; compositor frames cover the pre-module blank-paint boundary.
- `redeven:internal/envapp/ui_src/scripts/checkFileBrowserContinuity.mjs` - Files module, path-context, directory, empty result, and retry handoffs in the compiled Shell.
- `redeven:desktop/scripts/check-env-content-continuity.mjs` - Production Electron and Runtime document reload and window lifecycle evidence.
