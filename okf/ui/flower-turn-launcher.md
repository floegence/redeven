---
type: UI Contract
title: Flower turn launcher
description: Flower first-turn launchers collect scoped context and send one turn before handing off to the owning Flower surface.
tags: [ui, flower, desktop, env-app, interaction]
timestamp: 2026-06-17T00:00:00Z
---

Redeven uses a shared Flower turn launcher for contextual Ask Flower entrypoints. The launcher is a focused first-turn composer: it previews the captured context, accepts one prompt, calls the shared turn-launch contract, and then lets the host surface hand off to the correct full Flower chat destination.

# Mechanism

Shared Flower contracts define `FlowerTurnLauncherIntent`, context items, attachments, and `FlowerSurfaceAdapter.launchTurn`. `FlowerTurnLauncherWindow` renders the floating first-turn UI and exposes `onSubmit` instead of owning Desktop or Env App navigation. `FlowerSurface` uses the same `launchTurn` contract for normal chat sends, so new threads and continued conversations share one adapter path. Desktop Welcome opens the launcher from an environment card, builds the shared `assistant.ask.flower` context action, submits through the local environment adapter, creates a one-shot thread focus request for the returned thread id, and opens the Welcome Flower page. Env App captures its view-mode handoff context when the launcher opens; after a successful submit it creates the same one-shot AI thread focus request and routes to Activity, Deck, or Workbench using the captured target. Gateway sessions preserve `runtime_gateway` as their execution context source instead of falling through to generic remote sources. A linked context preview must correspond to a valid `context_action`, including target, locality, source surface, and execution hint values accepted by the runtime validator; hosts must reject an explicit malformed context action instead of silently sending a context-free turn.

Environment cards can expose placement-shaped targets such as local container, SSH, provider, or Gateway targets. These identifiers are routing context for Redeven, not permission to infer Docker, SSH, systemd, or Gateway control commands. Flower must interpret environment lifecycle requests through OKF and the `redeven env ... --json` surface so unsupported target kinds return structured product plans instead of lower-level command guesses.

# Boundaries

The launcher is not a persistent chat surface and does not inject drafts into the full Flower composer. Hosts must not navigate to Flower before a successful `launchTurn`, must not require a second send in the full chat, and must not re-read the current Env mode at submit time to decide the handoff target. Focus handoff is a consumed request, not persistent selected-thread state; after `FlowerSurface` accepts a request or the user selects another thread, the host clears that request so remounts and list refreshes cannot pull the user back to the handoff thread. Context actions are not UI-only metadata: the runtime validates the standard Ask Flower action and converts it into prompt-pack user context so the model receives the same scoped context the launcher displayed. The full Flower transcript may show a compact linked-context badge only for standard Ask Flower actions whose persisted envelope still satisfies the same target, source, and execution-context validity rules.

# Citations

[1] redeven:internal/flower_ui/src/contracts/flowerSurfaceContracts.ts:641 - Flower turn launcher source, context, intent, and adapter contracts live in shared Flower UI.
[2] redeven:internal/flower_ui/src/FlowerTurnLauncherWindow.tsx:38 - The shared launcher submit payload contains the prompt and the captured launcher intent.
[3] redeven:internal/flower_ui/src/FlowerTurnLauncherWindow.tsx:476 - The launcher send button submits the first turn directly from the floating window.
[4] redeven:internal/flower_ui/src/FlowerSurface.tsx:159 - `FlowerThreadFocusRequest` is the shared one-shot thread focus request shape.
[5] redeven:internal/flower_ui/src/FlowerSurface.tsx:901 - `FlowerSurface` starts each focus request once and delegates request consumption to the host.
[6] redeven:internal/flower_ui/src/FlowerSurface.tsx:1384 - Full transcript linked-context badges render only for valid Ask Flower context actions.
[7] redeven:desktop/src/welcome/App.tsx:9689 - Environment card Ask Flower controls open the floating launcher instead of navigating directly.
[8] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:858 - Env App captures the launcher handoff context when opening the launcher.
[9] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:1044 - Env App handoff uses the captured context to route the completed launch to Activity, Deck, or Workbench.
[10] redeven:desktop/src/welcome/App.tsx:5912 - Desktop Welcome submits the launcher prompt through the local environment Flower turn launcher path.
[11] redeven:desktop/src/welcome/App.tsx:5922 - Desktop Welcome creates the one-shot focus request after a successful launch.
[12] redeven:desktop/src/welcome/App.tsx:6164 - Desktop Welcome clears the focus request after `FlowerSurface` consumes it.
[13] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:840 - Env App creates and consumes one-shot AI thread focus requests.
[14] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:1111 - Env App submits launcher prompts through the env-local Flower adapter `launchTurn` contract.
[15] redeven:desktop/src/welcome/environmentFlowerContext.ts:108 - Desktop Welcome builds environment-card context with the shared Ask Flower context action contract.
[16] redeven:internal/ai/context_action.go:133 - Runtime validates Ask Flower context actions before converting them into model-facing user-provided context.
