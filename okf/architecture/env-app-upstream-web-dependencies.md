---
type: Frontend Contract
title: Env App upstream web dependencies
description: Env App composes published floe-webapp, Floeterm, and Flowersec web packages.
tags: [architecture, dependencies, protocol, ui]
timestamp: 2026-07-13T00:00:00Z
---

Env App is built as a Redeven-specific shell on top of published floe-webapp UI/runtime primitives, floe-webapp protocol connectivity, Floeterm terminal-web components, and Flowersec controlplane artifact helpers.

# Mechanism

The UI package pins released versions of the upstream packages. `EnvAppShell` imports floe-webapp providers, layout primitives, icons, and protocol hooks; terminal surfaces use Floeterm `TerminalCore` and `PagedTerminalOutputCoordinator`; controlplane services call Flowersec controlplane helpers to exchange entry tickets for connect artifacts; and local package-lock files are the audited dependency source for the embedded UI build. Activity and Workbench terminals map Redeven history-page RPCs and shell-activity projection into the same upstream output coordinator. Initial replay blocks terminal input, while background gap recovery and automatic retry remain non-blocking. The coordinator owns sparse sequence coverage, retained-live bounds, retry state, truncation rebases, and cancellation; Redeven owns only RPC conversion, terminal visibility, progress/error presentation, and product activity callbacks. `TerminalSessionRuntime` owns the Core, coordinator, snapshot, and per-session focus lifecycle, while `TerminalSessionNavigator` renders the desktop sidebar and mobile drawer from lightweight session state without instantiating a Core. `TerminalPanel` remains the product orchestration and composition owner instead of introducing a second terminal state model. Redeven's adaptive working-set manager does not impose a Core count: it keeps all opened cores warm below a device-derived byte budget, protects the current and recently switched sessions, and asks the released Floeterm core to capture or restore memory-only snapshots only from idle work. A hibernated core releases renderer resources while its PTY, output coordinator, unread state, and session-list row continue independently.

Env App keeps only bootstrap, access, protocol, and shell chrome in the initial module. Activity surfaces, Workbench, Terminal, Monitor, Files, Codespaces, Ports, Flower, Codex, Settings, Plugins, Debug Console, audit, file browser, and file preview hosts are loaded through feature boundaries when activated. Flower and Codex providers are scoped to the surfaces that need them, so a connected shell does not initialize AI settings, model catalogs, or thread lists by default. Feature CSS follows the same boundary: Iosevka loads with Terminal, shared Flower and chat styles load with Flower entry points, and Codex styles load with Codex entry points.

Activity navigation does not replace the Activity Shell or change its outer provider structure. `ActivityAppsMain` is the lifetime owner for Activity surfaces: a surface mounts on first activation and remains mounted but hidden while another Activity surface is active. This preserves file browser path, expanded directories, filtering, view mode, selection, scroll position, and equivalent local state in Terminal, Monitor, Flower, Codex, and other registered Activity surfaces. Switching between Activity and Workbench remains a separate product lifecycle boundary.

Codex keeps its heavy provider and feature CSS behind the lazy `CodexActivitySurface` boundary. The surface creates one shared Codex provider for the page and sidebar. The page stays inside the kept-alive Activity view, while the sidebar is projected through a Solid Portal into a lightweight Shell-owned host that exists only while Codex is active and permitted. The Portal mount remains stable when that host is removed or recreated, so returning to Codex moves the existing sidebar tree instead of recreating the provider, page, thread state, drafts, or sidebar-local state. If the Codex chunk resolves after navigation has already left Codex, it may finish mounting inside the hidden kept-alive surface without replacing the Shell or another Activity page.

The local bootstrap reuses the access status returned by `getLocalRuntime()` instead of issuing a second access-status request. Production builds enforce compressed initial-resource budgets of 600 KiB JavaScript, 120 KiB critical CSS, and 720 KiB total. The budget check also rejects initial HTML references to Markdown, KaTeX, Mermaid, Monaco, Excel, PDF, Shiki, Flower, or Codex feature assets.

# Boundaries

This concept only holds while Env App continues to consume published upstream packages instead of local sibling checkouts or ad-hoc replacements for protocol, terminal, and controlplane artifact handling. Redeven must not recreate Floeterm output recovery, snapshot formats, resource estimation, or shell lifecycle generation in product code. Lazy boundaries change loading time, not product contracts: restored surface state, permission gates, Workbench activation, error recovery, and provider ownership must remain equivalent after a feature chunk resolves. Activity-specific feature providers must live inside their kept-alive surface boundary; an active-surface condition must not wrap or replace the Activity Shell. Sidebar portals may change their visible host, but the provider and kept-alive surface remain the state owners. The initial budget is a required build gate and must not be bypassed by renaming or preloading feature assets through a different entry.

# Citations

[1] redeven:internal/envapp/ui_src/package.json:18 - Env App pins floe-webapp-core.
[2] redeven:internal/envapp/ui_src/package.json:19 - Env App pins floe-webapp-protocol.
[3] redeven:internal/envapp/ui_src/package.json:20 - Env App pins floeterm terminal-web.
[4] redeven:internal/envapp/ui_src/package.json:21 - Env App pins flowersec-core.
[5] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:2 - Env App shell imports floe-webapp runtime and layout primitives.
[6] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:24 - Env App shell consumes Flowersec observer typing for runtime connections.
[7] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:25 - Env App shell consumes the floe-webapp protocol hook.
[8] redeven:internal/envapp/ui_src/src/ui/widgets/TerminalSessionRuntime.tsx:3 - The per-session runtime imports released Floeterm Core and coordinator APIs.
[9] redeven:internal/envapp/ui_src/src/ui/widgets/TerminalSessionRuntime.tsx:484 - Activity and Workbench terminal sessions instantiate the same paged output coordinator.
[10] redeven:internal/envapp/ui_src/src/ui/services/terminalAdaptiveWorkingSet.ts:1 - Device-adaptive warm-core and snapshot-pool budgets are product policy over released Floeterm lifecycle APIs.
[11] redeven:internal/envapp/ui_src/src/ui/widgets/TerminalSessionNavigator.tsx:96 - Desktop and mobile session navigation consume lightweight session rows independently from terminal Core creation.
[12] redeven:internal/envapp/ui_src/src/ui/services/controlplaneApi.ts:2 - Controlplane services request entry connect artifacts through flowersec-core/controlplane.
[13] redeven:AGENTS.md:173 - Published Dependency Policy forbids local sibling wiring in package manifests and build aliases.
[14] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:176 - Env App declares Activity, Workbench, Codex, plugin, and floating-host lazy boundaries.
[15] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:2056 - Local bootstrap reuses the access status returned with runtime discovery.
[16] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:2215 - Codex is registered as one lazy Activity surface over a Shell-owned sidebar host accessor.
[17] redeven:internal/envapp/ui_src/src/ui/workbench/redevenWorkbenchWidgets.tsx:20 - Workbench feature bodies load through independent lazy boundaries.
[18] redeven:internal/envapp/ui_src/scripts/checkInitialBuildBudget.mjs:9 - Production builds enforce compressed JavaScript, CSS, and total initial-resource budgets.
[19] redeven:internal/envapp/ui_src/scripts/checkInitialBuildBudget.mjs:14 - Initial HTML is rejected when heavyweight renderer, Flower, or Codex assets are referenced.
[20] redeven:internal/envapp/ui_src/package.json:9 - The Env App production build always runs the initial-resource budget check.
[21] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:3174 - The Activity Shell exposes the Codex sidebar host only while Codex is active and permitted.
[22] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:3255 - `ActivityAppsMain` owns lazy mounting and keep-alive presentation for registered Activity surfaces.
[23] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:3383 - The registry renders a stable main Shell without active-surface-dependent outer providers.
[24] redeven:internal/envapp/ui_src/src/ui/codex/CodexActivitySurface.tsx:12 - The lazy Codex Activity boundary owns one provider, page, and stable sidebar Portal mount.
[25] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx:888 - Activity lifecycle regression coverage preserves Files state across Terminal, Monitor, Flower, and Codex navigation.
[26] redeven:internal/envapp/ui_src/src/ui/codex/CodexActivitySurface.test.tsx:71 - Portal host recreation moves the existing sidebar without remounting the Codex provider or page.
