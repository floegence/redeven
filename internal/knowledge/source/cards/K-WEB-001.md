---
id: K-WEB-001
version: 3
title: Env App composes floe-webapp runtime and protocol with Floeterm terminal-web and Flowersec controlplane helpers
status: stable
owners:
  - frontend
tags:
  - architecture
  - dependencies
  - protocol
  - ui
source_card_id: K-WEB-001
---

## Conclusion

Env App is built as a Redeven-specific shell on top of floe-webapp UI and runtime primitives, floe-webapp protocol connectivity, Floeterm terminal-web components, and Flowersec controlplane artifact helpers.

## Mechanism

The UI package pins released versions of all four upstream packages. `EnvAppShell` imports floe-webapp providers, layout primitives, icons, and protocol hooks; terminal surfaces use Floeterm `TerminalCore` and session coordination; controlplane services call Flowersec controlplane helpers to exchange entry tickets for connect artifacts; and the upstream sibling packages define the exported interfaces these Redeven surfaces consume.

## Boundaries

This card only holds while Env App continues to consume published upstream packages instead of local ad-hoc replacements for protocol, terminal, and controlplane artifact handling.

## Evidence

- redeven:internal/envapp/ui_src/package.json:18 - Env App pins floe-webapp-core.
- redeven:internal/envapp/ui_src/package.json:19 - Env App pins floe-webapp-protocol.
- redeven:internal/envapp/ui_src/package.json:20 - Env App pins floeterm terminal-web.
- redeven:internal/envapp/ui_src/package.json:21 - Env App pins flowersec-core.
- redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:2 - Env App shell imports floe-webapp runtime and layout primitives.
- redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:24 - Env App shell consumes Flowersec observer typing for runtime connections.
- redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:25 - Env App shell consumes the floe-webapp protocol hook.
- redeven:internal/envapp/ui_src/src/ui/widgets/TerminalPanel.tsx:9 - Terminal panel consumes Floeterm TerminalCore and terminal session abstractions.
- redeven:internal/envapp/ui_src/src/ui/services/controlplaneApi.ts:2 - Controlplane services request entry connect artifacts through flowersec-core/controlplane.
- floe-webapp:packages/core/package.json:14 - floe-webapp-core publishes app, layout, ui, and file-browser subpath exports used by Redeven.
- floe-webapp:packages/protocol/src/client.tsx:3 - floe-webapp protocol provider is built around Flowersec client, RPC, and reconnect primitives.
- floe-webapp:packages/protocol/src/index.ts:5 - floe-webapp protocol exports grant helpers to downstream consumers.
- floeterm:terminal-web/src/index.ts:1 - terminal-web exports TerminalCore and session coordination APIs consumed by Env App.
- floeterm:terminal-web/src/sessions/TerminalSessionsCoordinator.ts:47 - terminal-web maintains UI-facing terminal session reconciliation.
- flowersec:flowersec-ts/src/controlplane/request.ts:171 - Flowersec controlplane helpers exchange entry tickets for connect artifacts.

## Invalid Conditions

This card becomes invalid if Env App stops using these upstream package interfaces or replaces controlplane artifact, terminal, and UI semantics with unrelated local implementations.
