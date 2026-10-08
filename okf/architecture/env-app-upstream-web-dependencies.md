---
type: Frontend Contract
title: Env App upstream web dependencies
description: Env App composes published floe-webapp, Floeterm, and Flowersec web packages.
tags: [architecture, dependencies, protocol, ui]
timestamp: 2026-10-07T00:00:00Z
quality_exception: Published web dependency and terminal package boundary covering version pins, shell ownership, and renderer-free loading.
---
# Summary

Env App is built as a Redeven-specific shell on top of published floe-webapp UI/runtime primitives, floe-webapp protocol connectivity, Floeterm terminal-web components, and Flowersec controlplane artifact helpers.


Frontend deployment and lazy-import recovery follow [Env App page asset recovery](../ui/page-asset-recovery.md), using Floe's published document asset monitor and per-view error boundary.

# Contract

## Mechanism

Floe owns the loading icon slot, localized intrinsic label reservation, persistent feedback region, and resolved inline-media viewport contracts used by [asynchronous layout stability](../ui/asynchronous-layout-stability.md).

The browser dependency set includes the public Floeterm terminal-web v0.19.2 release, Floe Webapp Boot, Core, and Protocol v0.85.1, and Flowersec Core v5.10.5. Terminal-web is semantic-only and has no Ghostty WebAssembly or Beamterm dependency. Floe also owns borderless inline media, image enlargement, native playback, and isolated HTML; [Flower inline media](../ui/flower-inline-media.md) defines product resource authorization. Every published UI dependency resolves from the public npm registry. Local paths, links, workspaces, portals, aliases, runtime patches, private registries, and renderer fallbacks remain forbidden.

The Env App pins Boot, Core, and Protocol v0.85.1; Desktop pins Boot and Core v0.85.1. Both consume Flowersec Core v5.10.5 from the public registry. Env App Core v0.85.1 supplies the shared remote-pointer controller used by Host Applications. Each Floe package carries its own MIT metadata and license file. Floe Webapp owns the optional shared surface material and responsive control motion (consumed through the [product material contract](../ui/surface-material.md)), shell presets, generated token CSS, Monaco themes, accessible menu navigation, surface-aware floating layers, launcher landing previews and interruptible edge snapping, constrained native window geometry retention, shared configured interaction mode and adaptive sidebar measurement and retained navigation content with native scroll restoration, left/right side-drawer and mode-aware Dialog placement, bottom-drawer presentation and nested overlay input ownership, Activity Bar and Workbench Dock context-menu requests, before/after-component host Dock placement, Dock focus-cycle candidate ordering and session state, serialized dynamic registry contributions, bottom-bar companion behavior, terminal classification of rejected trusted spend bindings, and protocol-controller lifecycle ownership. Redeven supplies plugin-specific pin policy, ordering, menu copy, exact plugin-surface uniqueness, and the Activity-versus-Workbench Dialog placement decision, and selects the published `focus-cycle` Dock mode; Floe supplies the generic trigger, candidate resolution, selection, viewport, focus, projection, KeepAlive, modal dismissal, and lifecycle mechanics. Dock cycle position remains available through the accessible name and tooltip without rendering quantity badges over icons. The protocol controller fences state writes by owner generation, and Env App secure-session retry calls the published `replaceConnection()` operation so an old asynchronous close cannot overwrite the newly installed connection with `idle`. Redeven selects those public contracts and derives product semantic aliases from the active preset; it does not fork the catalog, synthesize a second token map, recreate upstream keyboard and layer state machines, or add a second Dialog or Dock cycling state machine. Shiki syntax themes remain a scoped exception while their chrome follows the shell preset, and Mermaid receives browser-resolved canonical sRGB colors with preset identity in its render cache key. Composition editing and matte Workbench surfaces consume the same release; [Workbench composition](../ui/workbench-composition.md) owns the product editing and persistence contract.

Floe Core v0.85.1 owns raw mouse/pen motion with microtask flushing and the shared remote-control icon catalog. The [remote desktop viewer](remote-desktop-viewer.md) defines their product use. Env App and Desktop retain root npm and pnpm DOMPurify overrides of `^3.4.16` because Monaco 0.57.0 still pins the older sanitizer; downstream overrides cannot be inherited from Floe. Remove this override only when the published Monaco dependency and both lock graphs resolve a patched sanitizer without it.

Terminal rendering, surface mapping, and interaction ownership are specified in [Env App terminal and surface composition](env-app-terminal-and-surface-composition.md). Connection recovery, Service Worker ownership, and transport-specific artifact sources are specified in [Env App connection and recovery](env-app-connection-and-recovery.md).
# Boundaries

Env App and Desktop use Solid 1.9.17 or newer for patched Seroval serialization.
They retain matching npm and pnpm root KaTeX overrides at `0.18.10` because
Mermaid still requests an older minor. Env App's direct KaTeX dependency uses
the same version. Remove the override only when Mermaid's published dependency
and both lock graphs resolve a patched release without it; dependency overrides
are not inherited from Floe. Rich Markdown browser acceptance covers math,
Mermaid, theme changes, and untrusted input against the resolved packages.

This concept only holds while Env App consumes published upstream packages. Redeven may select shell presets and map product permissions, credentials, local-path authority, and placement into upstream contracts, but it must not recreate Floe shell tokens, Flowersec reconnect/framing/RPC behavior, or Floeterm parsing, key encoding, history, attachment arbitration, geometry, Presentation encoding, cursor, graphics, or canvas rendering. Browser Ghostty, TerminalCore, checkpoint workers, raw replay, Beamterm, hidden compatibility canvases, and local sibling dependency wiring are prohibited. Lazy boundaries change loading time, not product contracts or state ownership.

The Env App recovery snapshot is a product presentation projection, not another protocol or Desktop transport mechanism. It must not infer retry timing, parse failure prose, invent attempts, add a backup URL, retry through public Local UI, migrate streams, rebind a stale session, or replay user requests. Explicit Start, Restart, Stop, and Update continue to hand off to Desktop Welcome and remain outside this post-open recovery flow.

Absolute filesystem navigation is owned by the published DirectoryPicker, DirectoryInput, and file-picker core. Redeven supplies runtime context and localized product adapters without a second tree or Home-relative path mode; [filesystem selection](../ui/filesystem-picker-navigation.md) defines the host contract.

Host application bootstrap styling consumes the released Core `standalone.css` export. Its generated inline bundle carries shared primitives, shell presets, surface material and focus behavior without loading the full component stylesheet or another runtime. The [titlebar contract](../desktop/host-application-titlebar.md) owns the product adapter and localized presentation.

The independent `@floegence/floe-webapp-core/resource-cache` entrypoint owns persistent resource state and eviction. [Env App resource snapshots](../ui/env-resource-cache.md) defines product projections and the Desktop storage bridge.

Floe Core also owns the worker-based graph layout, fixed and preferred world positions,
orthogonal routing, relationship bundles, viewport culling, and graph input
ownership used by [Tessiven](../ui/tessiven-canvas.md). Tessiven owns its DSL,
object projection, library, and authorized product operations.
The unmodified `elkjs@0.12.0` layout engine is consumed under its EPL-2.0
license option. `THIRD_PARTY_NOTICES.md` retains the verified original license
and exact upstream source reference; the generator checks that version and text.

# Evidence

- `redeven:internal/envapp/ui_src/package.json` - Env App pins Floe Webapp Boot, Core, and Protocol v0.85.1; Desktop pins Boot and Core.
- `redeven:internal/envapp/ui_src/src/ui/App.tsx:62` - Env App configures the published shell preset catalog and per-mode defaults.
- `redeven:internal/envapp/ui_src/src/ui/file-markdown/FileMarkdown.browser.test.tsx` - Chromium coverage renders CSS Color 4 Mermaid themes and one accessible KaTeX presentation across theme changes.
- `redeven:internal/envapp/ui_src/scripts/checkThemeColorSources.mjs` - The source gate rejects legacy component palettes and fixed Tailwind status colors in governed production surfaces.
- `redeven:internal/envapp/ui_src/src/ui/services/desktopTheme.ts:103` - The storage adapter projects Desktop-owned source and versioned shell selection into Floe persistence keys.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:2` - Env App shell imports floe-webapp runtime and layout primitives.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:2490` - Secure-session retry atomically replaces the protocol connection through the published controller.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx:4759` - Regression coverage requires one initial connect and one replacement without a separate disconnect.
- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalSessionRuntime.tsx` - The per-session runtime adapts released semantic renderer, input, history, activation, and live APIs.
- `redeven:internal/envapp/ui_src/src/ui/services/terminalPreferences.ts:1` - Persisted System/catalog selection preserves unknown values while resolving a released-theme fallback in memory.
- `redeven:internal/envapp/ui_src/src/ui/services/controlplaneApi.ts:501` - Local and remote acquisition inject durable spend and exact current-origin target validation into Floe Webapp's public source.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:542` - One Floe `ProxyBootstrapOwner` enforces the exact Service Worker script, scope, control, and runtime generation.
- `redeven:AGENTS.md:173` - Published Dependency Policy forbids local sibling wiring in package manifests and build aliases.
- `redeven:internal/envapp/ui_src/src/ui/workbench/redevenWorkbenchWidgets.tsx:20` - Workbench feature bodies load through independent lazy boundaries.
- `redeven:internal/envapp/ui_src/scripts/checkInitialBuildBudget.mjs:9` - Production builds enforce compressed JavaScript, CSS, and total initial-resource budgets.
- `redeven:internal/envapp/ui_src/src/ui/services/debugConsoleCapture.ts:503` - Terminal attach capture uses an explicit content-free request projection.
- `redeven:internal/envapp/ui_src/src/ui/services/terminalTransport.ts` - The live adapter opens only `terminal/live_v1` and delegates resize ordering and acknowledgement to Floeterm.
- `redeven:internal/envapp/ui_src/src/ui/services/terminalCatalogTransport.ts` - Catalog and history operations remain outside the initial live and renderer dependency graph.
- `redeven:internal/envapp/ui_src/scripts/checkPackagedRenderer.mjs` - The built-dist shell smoke uses a public Flowersec Go v5.10.5 WSS peer and validates production Env App assets without claiming a terminal or Electron package path.
- `redeven:internal/envapp/ui_src/scripts/checkSemanticTerminalCarrier.mjs` - The process carrier validates real Runtime, PTY, semantic Presentation, canvas, input, clear, history, resize, refresh, and multi-view behavior without starting Desktop.
- `redeven:internal/envapp/ui_src/src/ui/services/terminalTabActivity.ts:443` - Generation changes and rebases promote observed provisional unread before clearing coverage state.
- `redeven:internal/envapp/ui_src/src/ui/reconnect/createRuntimeReconnectController.ts:429` - Structured reconnect events advance exact protocol attempt counts without product retry heuristics.
- `redeven:internal/envapp/ui_src/src/ui/services/desktopSessionContext.ts:215` - Desktop recovery subscriptions reject stale generations and revisions.
- `redeven:internal/envapp/ui_src/src/ui/reconnect/ConnectionRecoveryView.tsx:124` - The unified recovery view renders progress, attempts, retry timing, terminal focus, and collapsed diagnostics.
