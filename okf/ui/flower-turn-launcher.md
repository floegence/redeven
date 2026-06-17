---
type: UI Contract
title: Flower turn launcher
description: Flower first-turn launchers collect scoped context and send one turn before handing off to the owning Flower surface.
tags: [ui, flower, desktop, env-app, interaction]
timestamp: 2026-06-17T00:00:00Z
---

Redeven uses a shared Flower turn launcher for contextual Ask Flower entrypoints. The launcher is a focused first-turn composer: it previews the captured context, accepts one prompt, calls the shared turn-launch contract, and then lets the host surface hand off to the correct full Flower chat destination.

# Mechanism

Shared Flower contracts define `FlowerTurnLauncherIntent`, context items, attachments, and `FlowerSurfaceAdapter.launchTurn`. `FlowerTurnLauncherWindow` renders the floating first-turn UI and exposes `onSubmit` instead of owning Desktop or Env App navigation. `FlowerSurface` uses the same `launchTurn` contract for normal chat sends, so new threads and continued conversations share one adapter path. Desktop Welcome opens the launcher from an environment card, submits through the local environment adapter, focuses the returned thread id, and opens the Welcome Flower page. Env App captures its view-mode handoff context when the launcher opens; after a successful submit it focuses the returned AI thread and routes to Activity, Deck, or Workbench using that captured target.

# Boundaries

The launcher is not a persistent chat surface and does not inject drafts into the full Flower composer. Hosts must not navigate to Flower before a successful `launchTurn`, must not require a second send in the full chat, and must not re-read the current Env mode at submit time to decide the handoff target.

# Citations

[1] redeven:internal/flower_ui/src/contracts/flowerSurfaceContracts.ts:641 - Flower turn launcher source, context, intent, and adapter contracts live in shared Flower UI.
[2] redeven:internal/flower_ui/src/FlowerTurnLauncherWindow.tsx:38 - The shared launcher submit payload contains the prompt and the captured launcher intent.
[3] redeven:internal/flower_ui/src/FlowerTurnLauncherWindow.tsx:476 - The launcher send button submits the first turn directly from the floating window.
[4] redeven:internal/flower_ui/src/FlowerSurface.tsx:1074 - The full Flower chat composer also sends through `props.adapter.launchTurn`.
[5] redeven:desktop/src/welcome/App.tsx:5963 - Desktop Welcome submits the launcher prompt through the local environment Flower turn launcher path.
[6] redeven:desktop/src/welcome/App.tsx:5979 - Desktop Welcome focuses the returned thread id before opening Flower.
[7] redeven:desktop/src/welcome/App.tsx:9626 - Environment card Ask Flower controls open the floating launcher instead of navigating directly.
[8] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:840 - Env App captures the launcher handoff context when opening the launcher.
[9] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:1026 - Env App handoff uses the captured context to route the completed launch to Activity, Deck, or Workbench.
[10] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:1111 - Env App submits launcher prompts through the env-local Flower adapter `launchTurn` contract.
