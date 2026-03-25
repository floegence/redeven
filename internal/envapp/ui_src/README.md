# Env App UI (Agent-Bundled)

This folder contains the **source code** for the agent-bundled Env App UI:

- Build output: `internal/envapp/ui/dist/env/*`
- Served by the agent local gateway under: `/_redeven_proxy/env/*`
- Delivered to the browser over Flowersec E2EE (runtime mode) when running the sandbox origin:
- `https://env-<env_id>.<region>.<base-sandbox-domain>/_redeven_boot/`
- Cross-surface product flows such as `File Browser -> Open in Terminal` and `Terminal -> Browse files` are implemented here through Env App shell/context orchestration rather than in the region frontend.
- Right-click menus that expose cross-surface handoffs are also normalized here so `Ask Flower` stays first, `Open in Terminal` stays second when available, `Browse files` follows when available, and separators isolate lower-priority follow-up actions.
- Git Browser branch detail tabs treat `Status` and `History` as a local mode switch: same-branch history toggles should preserve mounted UI state, reuse cached commit data when available, and keep loading indicators local to the history surface instead of replacing the whole browser shell.
- Terminal handoffs are attach-activated: opening a session only creates the logical terminal record, while the mounted terminal view performs the first attach with measured dimensions and then sends one explicit post-attach resize confirmation once layout has settled.
- Terminal size reclaim is focus-driven after attach: when the same session is shown in different surfaces, only the focused surface is allowed to emit remote resize updates, and restoring focus re-fits plus re-emits the current viewport so the active surface can reclaim remote PTY ownership.

Notes:

- The Redeven web app that opens the Env App stays outside this repository.
- This Env App contains the **env details** features (Deck/Terminal/Monitor/File Browser/Codespaces/Ports/Flower).
- File Browser uses Monaco as the single text preview/edit surface instead of splitting preview by language support or by a second highlighted renderer.
- Supported code previews remount Monaco when the user enters Edit mode so the writable editor never inherits stale read-only lifecycle state from preview mode.
- Truncated previews and preview-side Monaco runtime failures fall back to plain text only; edit mode never silently downgrades into a fake editable fallback and instead shows an explicit editor-unavailable state until the user discards or retries the edit session.

## CSS Layering Notes

- `src/index.css` already imports the upstream Tailwind and floe-webapp compiled style stack. Prefer relying on that base layer instead of reintroducing repository-local universal resets.
- Avoid global `border-style` injections on `*` selectors. They can turn intentional `border: none` declarations back into visible medium-width borders on native controls.
- When a visual adjustment only belongs to one surface or component family, scope it to that component class instead of patching every element globally.

## Flower Chat Render Contract

The Flower chat UI now follows four explicit constraints:

1. `EnvAIPage` owns the message source states.
   - Transcript rows, active-run snapshot recovery, live assistant stream overlays, and optimistic local user messages must converge through a single render projection before the chat store is updated.
   - Feature code must not add new direct `chat.setMessages()` write paths for individual recovery flows.

2. `VirtualMessageList` owns scroll anchoring.
   - `following` mode is bottom-pinned.
   - `paused` mode is anchored to the first visible message plus its in-item offset, so late message reflow does not pull the viewport upward.

3. Transcript overlays consume a shared bottom inset contract.
   - The transcript scroll area, file-browser FAB, and scroll-to-bottom affordance must use the shared transcript overlay inset variables instead of ad-hoc message margins.

4. Streaming assistant visibility is monotonic while a run is live.
   - Hidden `thinking` blocks are sideband data and must never reuse or replace an already-visible markdown slot.
   - Backend stream reconciliation should publish the next visible markdown state before clearing obsolete markdown slots whenever possible.
   - The render projection may temporarily carry forward the last non-empty visible assistant content for a still-streaming message when an intermediate overlay frame regresses to hidden-only content.

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
