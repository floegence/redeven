# Env App UI

This folder contains the source for the runtime-bundled Env App UI.

- Source root: `internal/envapp/ui_src/`
- Generated output: `internal/envapp/ui/dist/env/*`
- Runtime route: `/_redeven_proxy/env/*`
- Full product contract: [`docs/ENV_APP.md`](../../../docs/ENV_APP.md)

The Env App is built into the `redeven` binary and served by the local runtime gateway. Browser traffic reaches it through either the Flowersec runtime proxy or Local UI direct transport; authorization and isolation are enforced by runtime session metadata plus local policy, not by visible hostnames.

## Surface Boundaries

Env App owns environment-detail surfaces:

- Activity, Deck, and Workbench containers
- Terminal, Monitor, File Browser, Git, Codespaces, Web Services, Notes, Flower, Codex, and Runtime Settings
- Cross-surface handoffs such as `Ask Flower`, `Ask Codex`, `Open in Terminal`, and `Browse Files`

The container and business-surface state are separate:

- `EnvViewMode` selects the shell container: `activity`, `deck`, or `workbench`.
- `EnvSurfaceId` identifies the business surface: `terminal`, `monitor`, `files`, `codespaces`, `ports`, `ai`, `codex`, and related settings surfaces.
- The internal `ports` id remains the route for the user-facing Web Services surface.

Shared layout, shell, file-browser, note, and workbench primitives come from released `@floegence/floe-webapp-*` packages. Redeven should add product orchestration and business widget bodies here instead of forking generic shell behavior.

## Workbench Contract

Workbench code must keep ownership boundaries explicit:

- Shell chrome owns widget selection, drag, resize, overview/focus, and context-menu affordances.
- Widget bodies own their own text selection, focusable controls, dialogs, dropdowns, terminal focus, and local context menus.
- Wheel routing is selection-gated: unselected widgets do not own wheel input; a selected widget blocks canvas zoom inside its boundary; only marked local scroll viewports scroll locally.
- Production scroll candidates must use the exported Workbench wheel props and stay compatible with the `check:workbench-wheel` guard.

Runtime-shared Workbench state is intentionally narrow: widget identity/type, geometry, ordering, durable canvas objects, and small semantic widget state such as current Files path, Terminal session ids, and Preview target. Per-client camera, selection, transient gestures, drafts, scroll position, file-browser view preferences, and active terminal tab remain local.

## AI Surfaces

Flower and Codex are separate optional surfaces:

- Flower uses the runtime `/_redeven_proxy/api/ai/*` contract and stores its own thread/runtime state.
- Codex uses `/_redeven_proxy/api/codex/*` and delegates host behavior to the user's `codex` binary.
- Codex UI code stays under `src/ui/codex/*`; changes there must not patch Flower-owned selectors or runtime contracts.

Shared context actions should pass structured context envelopes to assistant surfaces instead of embedding assistant-specific prompt policy in Files, Terminal, Monitor, Git, or Codespaces widgets.

## Styling Notes

- `src/index.css` imports the upstream Tailwind and floe-webapp style stack.
- Env App panel surfaces should use the `--redeven-surface-panel*` token family from `src/styles/redeven.css`.
- App-owned floating windows must use `ENV_APP_FLOATING_LAYER` / `ENV_APP_FLOATING_LAYER_CLASS` from `src/ui/utils/envAppLayers.ts`.
- Tooltips and anchored overlays should use shared portal/positioning helpers rather than weakening overflow rules on cards or dialogs.
- Component-specific visual changes should stay scoped to the component or namespaced surface class.

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

The repository-level asset build also compiles this UI. From the repository root:

```bash
./scripts/build_assets.sh
```
