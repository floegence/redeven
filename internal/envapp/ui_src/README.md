# Env App UI (Runtime-Bundled)

This folder contains the **source code** for the runtime-bundled Env App UI:

- Build output: `internal/envapp/ui/dist/env/*`
- Served by the local runtime gateway under: `/_redeven_proxy/env/*`
- Delivered to the browser over Flowersec E2EE (runtime mode) when running the sandbox origin:
- `https://env-<env_id>.<region>.<base-sandbox-domain>/_redeven_boot/`
- Tunnel endpoint values surfaced in Env App observability views are routing metadata only; authorization/isolation remains session-metadata and policy-authorizer enforced.
- Cross-surface product flows such as `File Browser -> Open in Terminal` and `Terminal -> Browse files` are implemented here through Env App shell/context orchestration rather than in the region frontend.
- Env details shell navigation is explicitly split into container mode vs business surface state: `EnvViewMode` (`activity`, `deck`, `workbench`) selects the shell container, while `EnvSurfaceId` (`terminal`, `monitor`, `files`, `codespaces`, `ports`, `ai`, `codex`) identifies the business surface that handoffs and persistence target.
- Desktop now consumes the released floe-webapp display shell contract directly: `DisplayModeSwitcher` drives the header mode toggle, `DisplayModePageShell` owns the full-page `deck` / `workbench` frame, and mobile still resolves to `activity` without overwriting the stored desktop mode preference.
- `Activity` mode keeps the activity bar and shell sidebar model; `Deck` mode reuses the shared `DeckTopBar` chrome and exposes the singleton surface catalog as composable grid widgets; `Workbench` mode keeps the released floe-webapp workbench state/style contract but wraps it in a Redeven-owned input-routing surface so widget-local scroll, DOM focus, shell hotkey ownership, and widget-scoped dialog hosting all behave correctly for real Env App business widgets.
- That Redeven-owned workbench input-routing layer is also responsible for refreshing the shared workbench canvas measurement before keyboard navigation and shell-driven focus/ensure handoffs, so arrow-key navigation and cross-surface activation continue centering the target widget even when the local layout has only just become measurable.
- Workbench-local dialogs now follow the released `data-floe-local-interaction-surface="true"` contract from floe-webapp: dialog overlays portal into the widget host, pointer/wheel/context-menu routing yields to that local surface, outside widgets do not auto-close the dialog, and `Escape` still resolves from the focused boundary instead of broadcasting across the canvas.
- App-owned floating windows in workbench mode now follow the same local-interaction-surface contract as local dialogs: the shared floating surface and its geometry root both declare the boundary, so Solid portal event delegation can no longer leak titlebar/content/resize-handle pointerdown events back into canvas pan/zoom routing.
- Workbench widget ownership is now explicitly split between shell chrome and widget-local content: only header chrome marked with `WORKBENCH_WIDGET_SHELL_ATTR` may steal focus or open the workbench context menu, while selection, right-click, dialogs, dropdowns, and local floating surfaces inside the widget body stay component-owned.
- Redeven workbench widget identity is also `widget.id`-stable: click-to-front, focus routing, move, and resize only update the surface snapshot, so mounted business bodies such as Monitoring and Files keep their in-memory session state instead of remounting.
- Cross-surface requests route through the shell-owned `openSurface(...)` / mode-routing contract in `EnvAppShell` instead of assuming page-local sidebar semantics. In `deck` mode the shell focuses or inserts the target widget, in `workbench` mode it reveals or creates the target canvas surface, and opening Runtime Settings intentionally falls back through `activity` because settings remains an activity-owned configuration flow.
- Shared runtime providers stay above the mode split. Terminal runtime sessions remain coordinator-owned, so moving between `activity`, `deck`, and `workbench` remounts only the visible host surface without closing PTY sessions; Flower and Codex keep their controller/session ownership while swapping between shell-sidebar (`activity`) and inline rail (`deck` / `workbench`) containers; Redeven owns the business widget bodies, shell orchestration, and the local workbench input-routing adapter, but still relies on released floe-webapp helpers/types/CSS for the underlying workbench contract instead of rewiring to a sibling checkout.
- Right-click menus that expose cross-surface handoffs are also normalized here so `Ask Flower` stays first, `Open in Terminal` stays second when available, `Browse files` follows when available, and separators isolate lower-priority follow-up actions.
- File Browser multi-selection follows one shared contract across list and grid views: `Cmd/Ctrl` toggles items, `Shift` extends from the current anchor through the visible order, blank-area drag performs marquee selection, right-click on an already-selected item preserves the current selection, and right-click on an unselected item first collapses to that item before opening the menu.
- File Browser business menus intentionally keep the multi-select matrix narrow: background menus expose `Ask Flower`, `Open in Terminal`, and `New`; single folders add directory-only helpers plus `Duplicate`, `Copy Name`, `Copy Path`, `Rename`, and `Delete`; single files expose the same file-safe subset without directory helpers; multi-select only exposes `Ask Flower`, `Duplicate`, `Copy Name`, `Copy Path`, and `Delete`, so single-target actions never appear for a multi-target context.
- File Browser create flows stay shell-owned at the business layer but use the shared floe-webapp controlled reveal contract so newly created files/folders scroll into view and reuse the existing selected-state affordance without product-level DOM hacks.
- AI `write_todos` / task-plan snapshots should render as compact progress-first plan cards (`TodosBlock`) instead of raw status tables, so Codex-style planning updates feel native inside the chat thread.
- The optional Codex surface lives in `src/ui/codex/*` and intentionally follows the same high-level sidebar + transcript + bottom-dock rhythm as Flower while keeping all Codex-owned layout/state modules independent from Flower files.
- Codex UI state is controller-based: `CodexProvider` stays as orchestration glue, `createCodexThreadController` owns selected/foreground/displayed thread reconciliation plus session cache/bootstrap guards, and `createCodexDraftController` owns per-owner drafts (`draft:new` vs `thread:<id>`).
- Codex queued follow-ups are also controller-based and Codex-owned: `createCodexFollowupController` persists thread-scoped queued composer snapshots locally so follow-up ordering, restore/edit flows, and next-turn auto-send stay independent from Flower chat state.
- Codex active-thread lifecycle is session-owned: foreground transcript, pending requests, token usage, and stop/send state come from thread bootstrap + SSE projection rather than from `thread/list` polling.
- Codex send semantics intentionally mirror the official Codex chat contract:
  - the composer action slot always renders exactly one visible icon button;
  - idle or new-thread drafts send immediately;
  - an active run with an empty draft flips that same button to `Stop`;
  - an active run with draft content repurposes that same button to queue the prompt into the rail above the composer;
  - same-turn steering moves out of the composer and onto queued-item `Guide`, so the input never shows a second text action.
- Queued follow-up previews belong above the composer as a separate support lane, so queued state never consumes textarea action space or overlaps the prompt field.
- Queued follow-up cards are action-oriented instead of diagnostic:
  - click the card body to restore/edit;
  - use `Guide` to apply a queued prompt to the current turn when same-turn steer is available;
  - use remove and move controls without leaving the rail.
- Codex queued follow-up auto-send is foreground-session-owned: once the current thread becomes idle and no pending request/interrupt bootstrap is blocking, the next persisted follow-up is started from the queued runtime snapshot without relying on sidebar polling.
- Codex sidebar selection feedback is intent-owned: `selectedThreadID` updates immediately for visual response, while `foregroundThreadID` advances on the controller-owned activation step that drives bootstrap, read-marking, and header/composer ownership.
- Codex thread-list refresh is summary-only and identity-preserving: unchanged thread summaries reuse their previous browser objects so running sidebar indicators stay mounted and background polling does not reset their animation.
- Codex item lifecycle projection is bridge-owned and bootstrap-stable: `item/started` / streaming deltas establish working item state, `item/completed` closes that state even when the raw payload omits an explicit item status, and reopening a working thread after switching away must not resurrect historical assistant items as streaming rows.
- Codex composer autosizing is also controller-based and page-local: `CodexComposerShell` delegates multiline height measurement to `createCodexComposerAutosizeController`, which lazy-loads `@chenglou/pretext` only for the Codex page and preserves a DOM fallback when font/runtime conditions are unsafe.
- Codex composer information layout is intentionally asymmetric:
  - the prompt stays primary;
  - draft context stays left-aligned (`attachments`, working directory, draft objects);
  - execution strategy stays right-aligned (`model`, `reasoning effort`, `approval policy`, `sandbox mode`).
- Codex composer controls are intentionally not one-style-fits-all:
  - working directory keeps the stronger path-chip treatment;
  - `model` / `reasoning effort` collapse to lighter value-first controls at rest;
  - `approval policy` / `sandbox mode` keep compact tag-like strategy pills;
  - narrow composer widths restack into `context -> values -> policy pills`, and policy pills should only collapse from two columns to one when the composer itself becomes truly narrow;
  - mentions / attachments belong to a lower-priority draft-object lane instead of the strategy lane.
- Codex transcript follow-bottom is also controller-based and page-local: `CodexProvider` emits explicit bottom intents, and `createFollowBottomController()` keeps system restore paths instant while allowing smooth user-initiated convergence on the Codex page only.
- Codex transcript follow-bottom treats explicit user upward scrolling as an immediate pause signal even inside the near-bottom recovery band, so working-thread growth cannot steal scroll ownership back after the user starts reading history.
- Codex transcript expansion state is also transcript-owned: reasoning/plan rows start collapsed when first projected, then keep explicit expansion keyed by logical item id so stream updates and completion snapshots do not overwrite the user's chosen disclosure state.
- Codex follow-bottom targets the real bottom scroll position (`scrollHeight - clientHeight`) and preserves paused anchor restoration during late transcript reflow, so streaming growth no longer relies on repeated raw `scrollTop = scrollHeight` retries.
- Codex transcript layout is shell-based: a Codex-owned transcript shell establishes full-height viewport sizing first, then resolves `empty`, `loading`, or `feed` mode so welcome/loading heroes can center without depending on implicit parent height.
- Codex transcript rendering is intentionally split by role semantics:
  - assistant/evidence rows may use markdown rendering;
  - user rows render through the structured `CodexUserMessageContent` path using `item.inputs`;
  - user `text` inputs must stay raw text only, with preserved line breaks and no markdown/HTML rendering;
  - user `localImage` / `skill` inputs should reuse the shared file-preview surface instead of introducing a second preview modal.
- Codex file-change evidence keeps its data adaptation local to `src/ui/codex/*`, but the rendered patch surface now reuses the shared Git patch viewer contract so transcript diffs follow the same theme and patch-body presentation rules as Git browser previews.
- Codex turn lifecycle projection keeps `thread.turns` aligned with `turn_started` / `turn_completed` events, so stop/send transitions and header actions do not depend on stale bootstrap snapshots.
- Codex chat rows and the Codex send bar should align with Flower's message-lane and composer geometry through Codex-local implementation, not by patching Flower-owned selectors.
- The Codex send bar should read as floating over the transcript tail, so transcript and composer boundaries should prefer soft shadow/inset separation over an explicit full-width hard divider.
- Codex-specific visual adjustments belong in the namespaced `src/ui/codex/codex.css` layer instead of patching Flower selectors in `src/styles/redeven.css`.
- Git Browser branch detail tabs treat `Status` and `History` as a local mode switch: same-branch history toggles should preserve mounted UI state, reuse cached commit data when available, and keep loading indicators local to the history surface instead of replacing the whole browser shell.
- Git Browser top-level `Changes`, `Branches`, and `Graph` tabs treat re-entry as an activation revalidation boundary: already loaded content should stay visible immediately, cacheable branch/history data may render first, and the active surface must then background-refresh against the live repository so external Git changes appear without forcing a blank-shell reload.
- Git Browser commit diff review uses one explicit first-parent merge contract end to end: merge commit file lists and single-file commit diffs are derived under the same Git mode, and the UI labels that context instead of inheriting whatever merge-diff default a repository happens to use.
- Shared `GitDiffDialog` load state is selection-truthful and ownership-stable: once a changed file is selected, metadata-only commit/branch/stash entries transition directly into `loading`, `ready`, `error`, or explicit `unavailable` states, and equivalent parent rerenders must not duplicate the same selected-file diff request.
- Git Browser helper shortcuts such as `Ask Flower`, `Terminal`, and `Files` are intentionally styled as elevated orb actions inside a glass dock so they read as optional cross-surface capabilities rather than primary Git mutations.
- Git Browser selected cards intentionally rely on one shared selection surface plus shared nested-content helpers (`git-browser-selection-secondary`, `git-browser-selection-chip`) so stash/branch/sidebar selections stay readable without per-view hardcoded text colors.
- Git stash review intentionally reuses the shared compact changed-files table language plus `GitDiffDialog`, so mobile stays summary-first and single-file stash diffs never force a second inline split pane inside the stash window.
- Terminal handoffs are attach-activated: opening a session only creates the logical terminal record, while the mounted terminal view performs the first attach with measured dimensions and then sends one explicit post-attach resize confirmation once layout has settled.
- Terminal size reclaim is focus-driven after attach: when the same session is shown in different surfaces, only the focused surface is allowed to emit remote resize updates, and restoring focus re-fits plus re-emits the current viewport so the active surface can reclaim remote PTY ownership.
- Terminal output can now promote file-like references into modifier-click file-preview links. Resolution stays session-aware by using the live terminal working directory plus the runtime home path when `~/...` output appears.
- Terminal tabs now derive compact status chrome from shell integration plus background activity: command start still lights a spinner immediately, long-running interactive tools keep that spinner only while fresh output is actively arriving, quiet background tabs decay to an unread dot after unseen activity, bell events stay dot-only without a bell toast, and revisiting the tab clears the unread marker.
- Terminal shell integration now also emits an explicit `OSC 633;P;Cwd=<absolute-path>` marker whenever the prompt becomes ready, so `cd` updates keep tab titles and session-aware file actions in sync without reusing generic terminal-title parsing; the existing running/stopped chrome continues to rely on `A/B/D` and `RedevenActivity`.
- The Debug Console is a shell-level floating surface mounted in `EnvAppShell` instead of individual pages so it stays visible above page-local loading overlays and can keep streaming diagnostics while the settings page is busy.
- Runtime maintenance state also flows through `sys.ping`: the ping payload carries an optional maintenance snapshot (`kind`, `state`, `target_version`, `message`, timestamps) so Env App can surface immediate self-upgrade or restart failures without waiting for a blind timeout path.
- Local UI runtime maintenance now resolves `Latest version` from the public runtime manifest through the local runtime API, with ETag/TTL-backed caching, so the Settings surface does not collapse to a permanent dash in local mode once the runtime session is ready.
- Shared `DirectoryPicker` / `FileSavePicker` integrations in Env App are intentionally lazy-mounted on open so picker state always initializes from the latest `homePath` + `initialPath` pair. Downstream surfaces must keep picker-internal paths root-relative and convert back to absolute filesystem paths only at the boundary helpers.
- Working-directory pickers now also share one Env App-owned directory data source (`createDirectoryPickerDataSource`) that:
  - caches folder children per absolute path,
  - deduplicates in-flight RPC loads,
  - hydrates ancestor chains before declaring a picker path ready,
  - keeps path input, breadcrumb navigation, and tree reveal behavior aligned with the shared floe-webapp async picker contract instead of page-local expansion hacks.
- File Browser directory navigation is cache-assisted, target-truthful, and atomically committed: the currently rendered path stays stable until the requested target directory (or a fallback ancestor after delete/rename recovery) is ready, cached ancestors may still seed the next tree for responsiveness, user entry revalidates the requested target directory, explicit refresh force-reloads the current directory, and invalid cached targets recover by force-refreshing the nearest existing ancestor so external delete/rename changes do not strand stale tree content.
- File Browser path entry stays product-owned in the toolbar path slot: read mode keeps the breadcrumb, explicit `Go to path` entry points (`Cmd/Ctrl+L`, current-path activation, and the More menu action) switch that same slot into a temporary input, successful submits still commit atomically through `RemoteFileBrowser`, and invalid manual targets keep the draft open with inline feedback instead of silently falling back to an ancestor.
- File Browser keeps symbolic links as explicit browser semantics: directory links remain navigable, file links remain previewable, broken links stay visible but blocked from invalid preview/navigation paths, and the runtime no longer lets directory-like targets fall through into `fs/read_file` stream EOFs.

Notes:

- The Redeven web app that opens the Env App stays outside this repository.
- This Env App contains the **env details** features (Deck/Terminal/Monitor/File Browser/Codespaces/Ports/Flower/Codex).
- File Browser uses Monaco as the single text preview/edit surface instead of splitting preview by language support or by a second highlighted renderer.
- Supported code previews remount Monaco when the user enters Edit mode so the writable editor never inherits stale read-only lifecycle state from preview mode.
- Truncated previews and preview-side Monaco runtime failures fall back to plain text only; edit mode never silently downgrades into a fake editable fallback and instead shows an explicit editor-unavailable state until the user discards or retries the edit session.

## CSS Layering Notes

- `src/index.css` already imports the upstream Tailwind and floe-webapp compiled style stack. Prefer relying on that base layer instead of reintroducing repository-local universal resets.
- `HighlightBlock` theming is upstream-owned. Since `floe-webapp@0.35.30` isolates highlight-specific accent tokens, downstream Env App surfaces should consume that release instead of darkening shared accent/card tokens locally.
- Avoid global `border-style` injections on `*` selectors. They can turn intentional `border: none` declarations back into visible medium-width borders on native controls.
- When a visual adjustment only belongs to one surface or component family, scope it to that component class instead of patching every element globally.
- Env App standard panel surfaces live in the root-scoped `--redeven-surface-panel*` token family inside `src/styles/redeven.css`.
- `--card` and `--popover` are intentionally aliased to that Env App panel family, so contributors should reuse semantic surface tokens instead of hardcoding the light/dark RGB pair in component selectors.
- Any panel surface that must also style body-portal overlays such as tooltips or popovers must stay on the root theme scope; a page-local wrapper cannot reach those portals.
- Git browser strong review shells must use the shared `GitPanelFrame` / `GitTableFrame` primitives from `src/ui/widgets/GitWorkbenchPrimitives.tsx` instead of restating wrapper geometry ad hoc in `GitChangesPanel`, `GitBranchesPanel`, or `GitHistoryBrowser`; `redevenSurfaceRoleClass('panelStrong')` supplies surface semantics, not the full border/ring layout contract by itself.
- Git browser title dots are intentionally build-stable semantic selectors: `src/ui/widgets/GitChrome.ts` returns `git-tone-dot` plus `git-tone-dot--<tone>`, and `src/styles/redeven.css` owns the actual colors. Do not reintroduce raw `bg-*` utility strings for those dots.

## Floating Layer Contract

- Tooltips and other anchored floating affordances must not rely on inline absolute positioning inside dialog bodies, cards, or other `overflow-hidden` containers.
- The shared Env App tooltip primitive renders through a body-level portal and resolves viewport-safe anchor geometry so dialogs can keep their clipping and scroll boundaries intact.
- App-owned floating windows must use the centralized `ENV_APP_FLOATING_LAYER` / `ENV_APP_FLOATING_LAYER_CLASS` tokens in `src/ui/utils/envAppLayers.ts` instead of scattering raw `z-index` literals through widget surfaces.
- Workbench widgets must not reuse persisted `z_index` as raw CSS stacking values. Redeven consumes floe-webapp's normalized render-layer map so widget bring-to-front order stays stable without letting long-lived workbench widgets climb above app-level floating windows such as preview, browser, Ask Flower, stash confirmations, runtime update prompts, or the Debug Console.
- `EnvAppShell`'s top-left Redeven brand mark is not a generic `TopBarIconButton`: it keeps a 24px visual box so the logo centerline matches the desktop `ActivityBar` rail, and expands its hit target locally instead of offsetting shared shell chrome.
- `EnvAppShell` top-bar icon actions intentionally pass `tooltip={false}` on mobile while keeping desktop labels enabled through the shared upstream `TopBarIconButton`, so any structural fix for that toggle path belongs in `floe-webapp` first and then flows back here through a released semver upgrade.
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
   - A streaming assistant message bubble may expose at most one streaming cursor owner at a time; message composition selects the last visible eligible tail block, while earlier markdown blocks remain visible as committed content only.
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
