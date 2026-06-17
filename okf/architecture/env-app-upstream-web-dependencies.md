---
type: Frontend Contract
title: Env App upstream web dependencies
description: Env App composes published floe-webapp, Floeterm, and Flowersec web packages.
tags: [architecture, dependencies, protocol, ui]
timestamp: 2026-06-17T00:00:00Z
---

Env App is built as a Redeven-specific shell on top of published floe-webapp UI/runtime primitives, floe-webapp protocol connectivity, Floeterm terminal-web components, and Flowersec controlplane artifact helpers.

# Mechanism

The UI package pins released versions of the upstream packages. `EnvAppShell` imports floe-webapp providers, layout primitives, icons, and protocol hooks; terminal surfaces use Floeterm `TerminalCore` and session coordination; controlplane services call Flowersec controlplane helpers to exchange entry tickets for connect artifacts; and local package-lock files are the audited dependency source for the embedded UI build.

# Boundaries

This concept only holds while Env App continues to consume published upstream packages instead of local sibling checkouts or ad-hoc replacements for protocol, terminal, and controlplane artifact handling.

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
