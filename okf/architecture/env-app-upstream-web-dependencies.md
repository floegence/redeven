---
type: Frontend Contract
title: Env App upstream web dependencies
description: Env App composes published floe-webapp, Floeterm, and Flowersec web packages.
tags: [architecture, dependencies, protocol, ui]
timestamp: 2026-07-12T00:00:00Z
---

Env App is built as a Redeven-specific shell on top of published floe-webapp UI/runtime primitives, floe-webapp protocol connectivity, Floeterm terminal-web components, and Flowersec controlplane artifact helpers.

# Mechanism

The UI package pins released versions of the upstream packages. `EnvAppShell` imports floe-webapp providers, layout primitives, icons, and protocol hooks; terminal surfaces use Floeterm `TerminalCore` and session coordination; controlplane services call Flowersec controlplane helpers to exchange entry tickets for connect artifacts; and local package-lock files are the audited dependency source for the embedded UI build.

Env App keeps only bootstrap, access, protocol, and shell chrome in the initial module. Activity surfaces, Workbench, Terminal, Monitor, Files, Codespaces, Ports, Flower, Codex, Settings, Plugins, Debug Console, audit, file browser, and file preview hosts are loaded through feature boundaries when activated. Flower and Codex providers are scoped to the surfaces that need them, so a connected shell does not initialize AI settings, model catalogs, or thread lists by default. Feature CSS follows the same boundary: Iosevka loads with Terminal, shared Flower and chat styles load with Flower entry points, and Codex styles load with Codex entry points.

The local bootstrap reuses the access status returned by `getLocalRuntime()` instead of issuing a second access-status request. Production builds enforce compressed initial-resource budgets of 600 KiB JavaScript, 120 KiB critical CSS, and 720 KiB total. The budget check also rejects initial HTML references to Markdown, KaTeX, Mermaid, Monaco, Excel, PDF, Shiki, Flower, or Codex feature assets.

# Boundaries

This concept only holds while Env App continues to consume published upstream packages instead of local sibling checkouts or ad-hoc replacements for protocol, terminal, and controlplane artifact handling. Lazy boundaries change loading time, not product contracts: restored surface state, permission gates, Workbench activation, error recovery, and provider ownership must remain equivalent after a feature chunk resolves. The initial budget is a required build gate and must not be bypassed by renaming or preloading feature assets through a different entry.

# Citations

[1] redeven:internal/envapp/ui_src/package.json:18 - Env App pins floe-webapp-core.
[2] redeven:internal/envapp/ui_src/package.json:19 - Env App pins floe-webapp-protocol.
[3] redeven:internal/envapp/ui_src/package.json:20 - Env App pins floeterm terminal-web.
[4] redeven:internal/envapp/ui_src/package.json:21 - Env App pins flowersec-core.
[5] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:2 - Env App shell imports floe-webapp runtime and layout primitives.
[6] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:24 - Env App shell consumes Flowersec observer typing for runtime connections.
[7] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:25 - Env App shell consumes the floe-webapp protocol hook.
[8] redeven:internal/envapp/ui_src/src/ui/widgets/TerminalPanel.tsx:9 - Terminal panel consumes Floeterm TerminalCore and terminal session abstractions.
[9] redeven:internal/envapp/ui_src/src/ui/services/controlplaneApi.ts:2 - Controlplane services request entry connect artifacts through flowersec-core/controlplane.
[10] redeven:AGENTS.md:173 - Published Dependency Policy forbids local sibling wiring in package manifests and build aliases.
[11] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:169 - Env App declares activity, Workbench, provider, plugin, and floating-host lazy boundaries.
[12] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:2013 - Local bootstrap reuses the access status returned with runtime discovery.
[13] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:3338 - Feature providers and floating hosts mount only for the active or requested surface.
[14] redeven:internal/envapp/ui_src/src/ui/workbench/redevenWorkbenchWidgets.tsx:20 - Workbench feature bodies load through independent lazy boundaries.
[15] redeven:internal/envapp/ui_src/scripts/checkInitialBuildBudget.mjs:9 - Production builds enforce compressed JavaScript, CSS, and total initial-resource budgets.
[16] redeven:internal/envapp/ui_src/scripts/checkInitialBuildBudget.mjs:14 - Initial HTML is rejected when heavyweight renderer, Flower, or Codex assets are referenced.
[17] redeven:internal/envapp/ui_src/package.json:9 - The Env App production build always runs the initial-resource budget check.
