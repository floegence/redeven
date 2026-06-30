---
type: UI Contract
title: Flower turn launcher
description: Flower first-turn launchers collect scoped context and send one turn before handing off to the owning Flower surface.
tags: [ui, flower, desktop, env-app, interaction]
timestamp: 2026-06-30T00:00:00Z
---

Redeven uses a shared Flower turn launcher for contextual Ask Flower entrypoints. The launcher is a focused first-turn composer: it previews the captured context, accepts one prompt, calls the shared turn-launch contract, and then lets the host surface hand off to the correct full Flower chat destination.

# Mechanism

Shared Flower contracts define `FlowerTurnLauncherIntent`, context items, attachments, and the shared `FlowerSurfaceAdapter` turn controls: `launchTurn` for sending and `stopThread` for canceling the selected running thread. `FlowerTurnLauncherWindow` renders the floating first-turn UI and exposes `onSubmit` instead of owning Desktop or Env App navigation. `FlowerSurface` uses the same `launchTurn` contract for normal chat sends, so new threads and continued conversations share one adapter path. The full Flower composer uses `stopThread` when the selected thread is running or waiting for approval: with an empty draft, the primary action becomes a stop icon and cancels the current run; with a non-empty draft, the action remains send-shaped and executes stop before launching the typed turn. Desktop Welcome opens the launcher from an environment card, builds the shared `assistant.ask.flower` context action, submits through the local environment adapter, creates a one-shot thread focus request for the returned thread id, and opens the Welcome Flower page. Env App captures its view-mode handoff context when the launcher opens; after a successful submit it creates the same one-shot AI thread focus request and routes to Activity or Workbench using the captured target. Gateway sessions preserve `runtime_gateway` as their execution context source instead of falling through to generic remote sources. A linked context preview must correspond to a valid `context_action`, including target, locality, source surface, and execution hint values accepted by the runtime validator; hosts must reject an explicit malformed context action instead of silently sending a context-free turn.

Flower thread working directory is a Redeven product thread attribute decided at creation time. `FlowerSurfaceAdapter` exposes optional working-directory picker reads for path context and directory entries; Env App implements them through the existing runtime FS RPC, while Desktop Welcome implements them through the fixed runtime FS Local API bridge. In New chat, `FlowerSurface` keeps a local `workingDirDraft`, displays only the basename in the header chip, opens the shared `DirectoryPicker` when the chip is clicked, and sends `working_dir` only when creating a new thread. Existing threads display their immutable `thread.working_dir` basename with the full path in title/ARIA text; clicking that chip copies the full path and never opens a picker or patches the thread.

Env App implements `stopThread` with the existing AI RPC stop endpoint and then reloads the thread bootstrap. Desktop implements the same adapter method through the runtime Flower HTTP bridge, which allows `POST /_redeven_proxy/api/ai/threads/:id/cancel` and reloads `/live/bootstrap`. The app server thread cancel route preserves RWX permission checks and audit events while calling `StopThread`, so queued followups are recovered to drafts before the active run is canceled.

Environment cards can expose placement-shaped targets such as local container, SSH, provider, or Gateway targets. These identifiers are routing context for Redeven, not permission to infer Docker, SSH, systemd, or Gateway control commands. Flower must interpret environment lifecycle requests through the `redeven-environment` system skill and the `redeven env ... --json` surface so unsupported target kinds return structured product plans instead of lower-level command guesses. For arbitrary OS diagnostics on a selected target, the same skill routes Flower to `redeven targets exec --target <target> --command <agent-selected command> --json`, where Redeven owns target resolution and execution provenance.

# Boundaries

The launcher is not a persistent chat surface and does not inject drafts into the full Flower composer. Hosts must not navigate to Flower before a successful `launchTurn`, must not require a second send in the full chat, and must not re-read the current Env mode at submit time to decide the handoff target. Composer stop+send is not queueing: the current run is stopped first, and only then is the visible draft submitted through `launchTurn`; if stopping or sending fails, the typed draft remains in the composer. `waiting_user` threads stay on the structured input Continue flow and do not enter the stop/stop+send matrix. Focus handoff is a consumed request, not persistent selected-thread state; after `FlowerSurface` accepts a request or the user selects another thread, the host clears that request so remounts and list refreshes cannot pull the user back to the handoff thread. Thread working directories are not mutable after creation: appserver thread patch decoding rejects unknown fields such as `working_dir`, and an empty create request falls back to the runtime `agentHomeDir` before validation. Context actions are product records rather than UI-only metadata: the runtime validates the standard Ask Flower action before accepting the turn, persists the normalized envelope with the transcript message, and leaves provider-visible context lifecycle to Floret. The target context does not alter builtin tool execution. In particular, `terminal.exec` still runs in the local AI runtime; only Redeven product command results or target-routed tool results with explicit `execution_location` can justify saying a command ran on a selected target. The full Flower transcript may show a compact linked-context badge only for standard Ask Flower actions whose persisted envelope still satisfies the same target, source, and execution-context validity rules.

# Citations

[1] redeven:internal/flower_ui/src/contracts/flowerSurfaceContracts.ts:739 - `FlowerSurfaceAdapter` exposes `stopThread` alongside `launchTurn`.
[2] redeven:internal/flower_ui/src/FlowerTurnLauncherWindow.tsx:38 - The shared launcher submit payload contains the prompt and the captured launcher intent.
[3] redeven:internal/flower_ui/src/FlowerTurnLauncherWindow.tsx:476 - The launcher send button submits the first turn directly from the floating window.
[4] redeven:internal/flower_ui/src/FlowerSurface.tsx:1188 - `FlowerSurface` stops the selected thread through the shared adapter before applying the returned bootstrap.
[5] redeven:internal/flower_ui/src/FlowerSurface.tsx:1203 - `FlowerSurface` chooses the stop/stop+send branch before normal chat send.
[6] redeven:internal/flower_ui/src/FlowerSurface.tsx:1672 - The composer primary action switches to stop only when the selected thread can stop and the draft is empty.
[7] redeven:desktop/src/welcome/App.tsx:9689 - Environment card Ask Flower controls open the floating launcher instead of navigating directly.
[8] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:884 - Env App captures the launcher handoff context when opening the launcher.
[9] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:1070 - Env App handoff uses the captured context to route the completed launch to Activity or Workbench.
[10] redeven:desktop/src/welcome/App.tsx:5912 - Desktop Welcome submits the launcher prompt through the local environment Flower turn launcher path.
[11] redeven:desktop/src/welcome/App.tsx:5922 - Desktop Welcome creates the one-shot focus request after a successful launch.
[12] redeven:desktop/src/welcome/App.tsx:6164 - Desktop Welcome clears the focus request after `FlowerSurface` consumes it.
[13] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:866 - Env App creates and consumes one-shot AI thread focus requests.
[14] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:1146 - Env App submits launcher prompts through the env-local Flower adapter `launchTurn` contract.
[15] redeven:desktop/src/welcome/environmentFlowerContext.ts:108 - Desktop Welcome builds environment-card context with the shared Ask Flower context action contract.
[16] redeven:internal/ai/context_action.go:133 - Runtime validates Ask Flower context actions before accepting the product turn.
[17] redeven:internal/envapp/ui_src/src/ui/flower/envLocalFlowerSurfaceAdapter.ts:428 - Env App `stopThread` calls the AI RPC stop endpoint and reloads the thread.
[18] redeven:desktop/src/welcome/flower/localEnvironmentFlowerSurfaceAdapter.tsx:421 - Desktop `stopThread` posts to the runtime thread cancel endpoint and reloads live bootstrap.
[19] redeven:desktop/src/main/main.ts:7457 - Desktop runtime Flower allowlist accepts the thread cancel path.
[20] redeven:internal/codeapp/appserver/server.go:4013 - The app server thread cancel route calls `StopThread` while preserving permission and audit handling.
[21] redeven:internal/flower_ui/src/contracts/flowerSurfaceContracts.ts:1105 - `FlowerSurfaceAdapter` exposes optional working-directory picker read methods.
[22] redeven:internal/flower_ui/src/FlowerSurface.tsx:1001 - `FlowerSurface` enables the picker only when both working-directory read methods exist.
[23] redeven:internal/flower_ui/src/FlowerSurface.tsx:1034 - The working-directory chip title uses the full path while the visible label can stay compact.
[24] redeven:internal/flower_ui/src/FlowerSurface.tsx:1089 - Existing thread working-directory chip clicks copy the full path instead of opening the picker.
[25] redeven:internal/flower_ui/src/FlowerSurface.tsx:2545 - `launchTurn` includes `working_dir` only when creating a new thread.
[26] redeven:internal/flower_ui/src/FlowerSurface.tsx:5810 - DirectoryPicker selection writes the absolute path into the New chat draft.
[27] redeven:internal/envapp/ui_src/src/ui/flower/envLocalFlowerSurfaceAdapter.ts:371 - Env App implements picker reads through the existing runtime FS RPC.
[28] redeven:desktop/src/welcome/flower/localEnvironmentFlowerSurfaceAdapter.tsx:496 - Desktop Welcome implements picker reads through the runtime FS Local API bridge.
[29] redeven:internal/flower_ui/src/filePicker/path.ts:13 - Shared Flower UI path helpers derive the basename used by the header chip.
[30] redeven:internal/flower_ui/src/filePicker/createDirectoryPickerDataSource.ts:31 - Shared Flower UI directory-picker data source converts picker paths through the configured home path.
[31] redeven:internal/ai/threads.go:380 - Creating a thread falls back to `agentHomeDir` when no working directory is supplied.
[32] redeven:internal/codeapp/appserver/server.go:3843 - Thread PATCH decoding rejects unknown fields such as `working_dir`.
