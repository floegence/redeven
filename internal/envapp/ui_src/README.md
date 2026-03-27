# Env App UI (Agent-Bundled)

This folder contains the **source code** for the agent-bundled Env App UI:

- Build output: `internal/envapp/ui/dist/env/*`
- Served by the agent local gateway under: `/_redeven_proxy/env/*`
- Delivered to the browser over Flowersec E2EE (runtime mode) when running the sandbox origin:
- `https://env-<env_id>.<region>.<base-sandbox-domain>/_redeven_boot/`
- Tunnel endpoint values surfaced in Env App observability views are routing metadata only; authorization/isolation remains session-metadata and policy-authorizer enforced.
- Cross-surface product flows such as `File Browser -> Open in Terminal` and `Terminal -> Browse files` are implemented here through Env App shell/context orchestration rather than in the region frontend.
- Right-click menus that expose cross-surface handoffs are also normalized here so `Ask Flower` stays first, `Open in Terminal` stays second when available, `Browse files` follows when available, and separators isolate lower-priority follow-up actions.
- The optional Codex surface lives in `src/ui/codex/*` and intentionally follows the same high-level sidebar + transcript + bottom-dock rhythm as Flower while keeping all Codex-owned layout/state modules independent from Flower files.
- Codex UI state is controller-based: `CodexProvider` stays as orchestration glue, `createCodexThreadController` owns selected/displayed thread reconciliation plus session cache/bootstrap guards, and `createCodexDraftController` owns per-owner drafts (`draft:new` vs `thread:<id>`).
- Codex chat rows and the Codex send bar should align with Flower's message-lane and composer geometry through Codex-local implementation, not by patching Flower-owned selectors.
- Codex-specific visual adjustments belong in the namespaced `src/ui/codex/codex.css` layer instead of patching Flower selectors in `src/styles/redeven.css`.
- Git Browser branch detail tabs treat `Status` and `History` as a local mode switch: same-branch history toggles should preserve mounted UI state, reuse cached commit data when available, and keep loading indicators local to the history surface instead of replacing the whole browser shell.
- Git Browser helper shortcuts such as `Ask Flower`, `Terminal`, and `Files` are intentionally styled as elevated orb actions inside a glass dock so they read as optional cross-surface capabilities rather than primary Git mutations.
- Terminal handoffs are attach-activated: opening a session only creates the logical terminal record, while the mounted terminal view performs the first attach with measured dimensions and then sends one explicit post-attach resize confirmation once layout has settled.
- Terminal size reclaim is focus-driven after attach: when the same session is shown in different surfaces, only the focused surface is allowed to emit remote resize updates, and restoring focus re-fits plus re-emits the current viewport so the active surface can reclaim remote PTY ownership.
- The Debug Console is a shell-level floating surface mounted in `EnvAppShell` instead of individual pages so it stays visible above page-local loading overlays and can keep streaming diagnostics while the settings page is busy.

Notes:

- The Redeven web app that opens the Env App stays outside this repository.
- This Env App contains the **env details** features (Deck/Terminal/Monitor/File Browser/Codespaces/Ports/Flower/Codex).
- File Browser uses Monaco as the single text preview/edit surface instead of splitting preview by language support or by a second highlighted renderer.
- Supported code previews remount Monaco when the user enters Edit mode so the writable editor never inherits stale read-only lifecycle state from preview mode.
- Truncated previews and preview-side Monaco runtime failures fall back to plain text only; edit mode never silently downgrades into a fake editable fallback and instead shows an explicit editor-unavailable state until the user discards or retries the edit session.

## CSS Layering Notes

- `src/index.css` already imports the upstream Tailwind and floe-webapp compiled style stack. Prefer relying on that base layer instead of reintroducing repository-local universal resets.
- Avoid global `border-style` injections on `*` selectors. They can turn intentional `border: none` declarations back into visible medium-width borders on native controls.
- When a visual adjustment only belongs to one surface or component family, scope it to that component class instead of patching every element globally.
- Env App standard panel surfaces live in the root-scoped `--redeven-surface-panel*` token family inside `src/styles/redeven.css`.
- `--card` and `--popover` are intentionally aliased to that Env App panel family, so contributors should reuse semantic surface tokens instead of hardcoding the light/dark RGB pair in component selectors.
- Any panel surface that must also style body-portal overlays such as tooltips or popovers must stay on the root theme scope; a page-local wrapper cannot reach those portals.

## Floating Layer Contract

- Tooltips and other anchored floating affordances must not rely on inline absolute positioning inside dialog bodies, cards, or other `overflow-hidden` containers.
- The shared Env App tooltip primitive renders through a body-level portal and resolves viewport-safe anchor geometry so dialogs can keep their clipping and scroll boundaries intact.
- New anchored overlays should reuse the shared positioning helper instead of weakening dialog/container overflow rules just to make a floating layer visible.

## Flower Chat Render Contract

The Flower chat UI now follows five explicit constraints:

1. `EnvAIPage` owns transport/page wiring, while dedicated controllers own render-state reconciliation.
   - `createAIThreadRenderController` owns transcript rows, active-run snapshot recovery, live assistant stream overlays, optimistic local user carry-forward, and transcript-derived subagent state before the chat store is updated.
   - `createAIContextTelemetryController` owns run-scoped context usage, compaction, and replay cursor binding.
   - `EnvAIPage` may consume controller accessors and invoke controller methods, but feature code must not re-implement those reducers inline, add new direct `chat.setMessages()` write paths for individual recovery flows, or introduce projection feedback loops where derived render output becomes the source of truth for controller state.

2. A live run owns exactly one assistant surface in the transcript tail.
   - Settled transcript rows stay transcript-only `MessageItem` rows.
   - In-flight assistant output renders through a dedicated non-virtualized live surface mounted at the transcript tail, not through synthetic transcript messages.
   - Pending lifecycle states, empty streaming placeholders, hidden-only `thinking`, streamed answer content, finalization status, and transcript catch-up are all inner states of that one mounted live surface.
   - Synthetic pending assistant messages, display-slot adoption, and frontend-only message-id remapping are forbidden.

3. `VirtualMessageList` owns scroll anchoring.
   - `following` mode is bottom-pinned.
   - `paused` mode is anchored to the first visible message plus its in-item offset, so late message reflow does not pull the viewport upward.
   - The live assistant tail is the only non-virtualized appendage inside the scroll container. Live-run status changes must stay inside that tail surface instead of competing with transcript row ownership.
   - Follow-mode resize handling must preserve the current bottom anchor by applying measured height deltas from transcript rows, the live tail, and the scroll viewport itself. Streaming line wraps must not be implemented as repeated full `scrollToBottom()` retries.

4. Transcript overlays consume a shared bottom inset contract.
   - The transcript scroll area, file-browser FAB, and scroll-to-bottom affordance must use the shared transcript overlay inset variables instead of ad-hoc message margins.

5. Streaming assistant visibility is monotonic while a run is live.
   - Hidden `thinking` blocks are sideband data and must never reuse or replace an already-visible answer slot.
   - Thinking-only or otherwise hidden live frames must keep the live assistant surface mounted instead of toggling ownership between transcript rows, placeholders, or footer containers.
   - Backend stream reconciliation should publish the next visible answer state before clearing obsolete answer slots whenever possible.
   - The live-run state reducer may temporarily carry forward the last richer visible answer content when an intermediate live frame or recovered snapshot regresses to hidden-only or poorer visible content for the same run lineage.
   - Bubble and block renderers must preserve stable mounted slots when streaming frames replace block objects; switching block type guards must not implicitly remount the visible answer subtree.

6. Context telemetry is run-scoped and monotonic.
   - Context usage, compaction events, and replay cursors belong to `run_id`-scoped UI state instead of one resettable page-level slot.
   - Thread-scoped runtime metadata must expose the latest context-bearing run (`last_context_run_id`) so completed threads can recover their latest summary without relying on ephemeral page memory.
   - The page runtime must distinguish the active live run from the latest stable context-bearing run. If a new live run has not produced telemetry yet, the UI should continue showing the latest stable summary instead of flickering back to an empty chip.
   - Rebinding the active thread to the same known run must preserve already-visible context telemetry; replay/backfill is incremental and must not clear the current chip state first.
   - The bottom-dock context summary may mount before usage telemetry arrives, but it must not disappear and reappear for the same run because of confirmation or replay timing.
   - Context details popovers must render through a body-level anchored overlay so toolbar overflow/scroll rules cannot clip the panel.

7. Transcript presentation is a shared conversation column.
   - User and assistant rows render in the same centered transcript lane instead of splitting into separate left/right screen rails.
   - Within that shared lane, assistant rows stay left-aligned and user rows stay right-aligned so the transcript still reads like a conversation.
   - Only assistant rows render an avatar; user rows rely on bubble styling and right-side placement for distinction.
   - Assistant answers render as borderless transcript content, while user turns keep the compact bubble treatment.
   - Runtime chips in the bottom toolbar must stay inside a stable single-line lane so chip churn cannot resize the transcript viewport mid-stream.

## Verification

From this directory:

```bash
pnpm install --frozen-lockfile
pnpm run lint
pnpm run test
pnpm run test:browser
pnpm run typecheck
pnpm run build
```

The build output is written to `../ui/dist/`.
