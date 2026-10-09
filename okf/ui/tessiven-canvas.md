---
type: UI Contract
title: Tessiven canvas
description: Render progressively detailed service topology and exact object context.
tags: [ui, tessiven, graph]
timestamp: 2026-10-09T00:00:00Z
---
# Summary

Tessiven presents one progressively detailed canvas for understanding where
business services run. Solid Runtime node cards sit inside tinted dashed visual
groups; external dependencies use a separate card treatment. Edges are muted
until a related group or object is focused. Wheel zoom and drag pan belong to
the canvas, while object details and the read-only document remain normal selectable
text. Flower is the editing surface; the canvas has no manual content editor.

# Contract

Workbench opens Service Canvas as a standalone window. In Desktop, the renderer
sends only an optional canvas and saved-version identity through the typed shell
bridge. Main authorizes the owning Env App main frame, builds the address from
that session, and creates or reuses its tracked child window. An explicit native
acknowledgement owns success; Chromium's denied `window.open` return value does
not describe whether Desktop created a window. Browsers retain popup-blocking
feedback, and native refusal or failure remains visible through localized command
feedback without starting another opening path.
The standalone canvas mounts only after the Shell's first authorized session is
ready, so an initial saved-version request uses the session HTTP owner. First
connection failures show the existing session recovery actions. Once mounted,
transient connection recovery retains the existing canvas view.

Automatic layout and library thumbnails use Floe's published compound packing
with a landscape aspect ratio. Independent members are arranged as readable
peers inside their dashed logical group. Relations retain their original
endpoints and ports; grouping never invents a relationship. Saved world
positions remain preferred hints, and expansion retains the inspected anchor.
Published Floe jointly routes packed and positioned relationships orthogonally.
Free anchors can use the available spans of all four node and dashed-group
borders, favor nearby facing spans, and separate parallel paths into lanes.
Routes avoid intervening cards and unrelated group frames. Explicit port sides,
relationship identities, and canonical endpoints remain unchanged. Dense
cross-layer topologies can still require crossings; hover and focus isolate
related routes without hiding relationships from the saved document.
Positioned objects without relationships still contribute their actual world
bounds, so fitting a newly mapped or isolated node keeps it inside the viewport.

- The library uses one toolbar with search, direct creation, and a secondary
  menu for archived canvases. It has no extra heading, archive tab, or status
  bar. New canvas immediately creates and opens an empty saved canvas.
- Each library card previews the current saved document through the same
  projection and published Floe layout engine used by the canvas. It shows
  nodes, groups, resources, and routed relationships without creating a second
  editable graph surface. Title, version, date, description, and object counts
  sit in a lower overlay; hover and keyboard focus reveal details without
  changing card geometry, while touch displays those details by default.
- A new empty canvas starts with the canonical Flower composer at the bottom;
  no reply window appears before the first send. Sending moves into one movable
  Flower window that contains the transcript, composer, questions, approvals
  and retry controls. Existing canvases open this combined window directly.
  Hiding and restoring affects the whole conversation and preserves its draft.
  There is no editor drawer, additional status bar, or repeated canvas
  identity/version row above the input. Compact removable object chips appear inside the
  input under the [Flower reference contract](flower-composer-references.md),
  with version metadata confined to its hover title and no instructional
  placeholder. Default whole-canvas context is implicit and stays hidden;
  removing the last object returns to that default. The Flower request carries the exact visible canvas/version
  and selected-object context through its context action.
- Replies and tool activity use the canonical Flower runtime in a quiet
  upper-left floating window under the
  [canvas reply contract](tessiven-flower-replies.md). The composer remains
  inside that window after the first send; hiding it preserves the conversation.
- Empty-canvas suggestions and every Ask Flower action focus the composer with
  exact canvas/version/object context. Opening never sends automatically.
- Each canvas retains its draft and selected conversation within the mounted
  surface. The connection's canonical ComposerDraftStore owns text, references
  and attachments; ThreadCache and TransportOutbox retain their existing roles.
  There is no separate editor admission controller or provider state machine.
- Sends freeze the visible selection before asynchronous preparation. Unknown
  delivery retries retain that payload and request identity. Switching objects
  or canvases cannot retarget an in-flight request or its eventual response.
- Settings, permissions, model selection, attachments, stop, approval and retry
  use the native Flower controls. Opening the full conversation is optional.
  Env App and Desktop readiness keep the canvas visible and confine recovery controls to
  a bottom card; its wrapper never paints an opaque full-canvas background.
- The visible version supplies the context for subsequent messages, including
  explicit history. Saved-version events update current views only; they do not
  infer completion of a Flower turn.
- The graph surface disables native text selection and cancels `selectstart`,
  so dragging to pan never selects card labels or other graph content. Text
  outside the graph, including the Flower composer and document viewer, keeps
  its normal selection behavior.
- Flower saves are durable without an open canvas client. Every connected SSE
  canvas client receives the same coalesced invalidation, and a client that
  reconnects or opens later receives an initial invalidation before reading the
  current snapshots.
- The built-in example is identified in its library preview and open canvas.
  It demonstrates topology without claiming actual connections or health.
- Flower saves update a canvas being viewed as current. Explicit historical
  views remain pinned; the user can choose to open the latest version.
- The document viewer and export are read-only. Content changes, including
  renaming and restoring earlier content, are made through Flower.

- Env App exposes Service Canvas after Flower and before pinned Activity plugin
  entries. Activity navigation keeps the regular shell and sidebar mounted; the
  header has no duplicate canvas shortcut. In Workbench, the Service Canvas
  action sits immediately to the right of the Plugin Center action, uses a
  themed rounded tile icon, and opens a dedicated Service Canvas window. The
  toolbar reuses the shared resource-header sizing used by other resource
  pages. It participates in the desktop titlebar drag/no-drag contract, and
  the window renders only the canvas surface and its own controls; it does not
  mount the Activity or Workbench shell, navigation, or Env App frame.
- Canvas invalidation uses one host-owned event stream. A transient stream end
  or transport failure is retried with bounded backoff; after three consecutive
  failed connections the surface exposes the reconnect action while retaining
  the last saved data. Reconnecting invalidates snapshots and does not create a
  cursor journal or a second polling loop.

- Up to 15 Runtime nodes in a group are shown individually. Larger groups use
  a name or ordinal selector and render only the selected node's details.
- A mixed-deployment host appears inside every logical group it belongs to.
  Every appearance lists its complete physical service inventory, including
  services belonging to other groups. A subtle service-row accent identifies
  exact membership of the current group; shared-host markers show the number
  of groups without a tooltip. Counts, service operations and Flower references
  use canonical objects, never visual replicas.
- Hover and focus apply the same title, surface and border color to all visible
  appearances of the canonical host without opening a popup. Clicking retains
  the existing object-details popup and adds a compact group list there.
  Locating another appearance expands its group when necessary and preserves
  the current object reference; closing restores focus. Service-row clicks
  continue to open exact instance details and bound-service inspection.
- Clicking opens object details. Hover tracks related edges without opening
  explanatory UI; right-click, keyboard context menu, and touch context entry
  open Ask Flower with the exact immutable canvas/version selection.
- Every graph Ask Flower entry uses the canonical Flower bloom in a compact
  accented action, including object details, context menus and the canvas menu.
- Relations between co-located service or instance endpoints appear as compact
  source-to-target rows within the host card, rather than a group self-loop.
  Explicit instance endpoints remain exact; service-level routing stays at the
  logical aggregate without expanding every host pair. Collapsed groups retain
  internal relations as inspectable rows. Each row opens the original relation
  and evidence and references that relation when asking Flower. A repeated host
  appearance retains the same complete inventory and local relation rows.
  Card and group bounds budget every service and relation row, including the
  expansion action, so content never spills outside its node or dashed frame.
- Layout hints are read from the saved document and applied only to visible
  graph objects; hidden members retain their hints for later expansion.
  Both the canvas and library thumbnail use published Floe's preferred-position
  mode. Clear coordinates stay exact; crowded sibling cards and complete group
  subtrees move apart, and groups fit their actual content before every relation
  is routed. Generated hints cannot turn a valid topology into a blank canvas
  merely because card heights or expansion changed. Rendering never rewrites
  saved hints or creates a new document version. Invalid graph data and actual
  worker/routing failures remain visible errors.
- Theme tokens, high contrast, product locale, and accessible names are used
  for every card, edge, menu, and action.

# Boundaries

The released Floe graph component owns pan, zoom, routing, layout, focus, and
floating-layer mechanics. Redeven owns the Tessiven projection and business
data. The graph renders the [saved version document](../architecture/tessiven-canvas-contract.md)
without introducing independent topology state. Selecting a node, group, or
historical version cannot change its management permissions. Ask Flower focuses
the canvas composer and never sends a message automatically.

# Evidence

- `desktop/src/shared/desktopShellServiceCanvasWindowIPC.ts` - Identity-only native window request and explicit acknowledgement.
- `desktop/src/main/main.ts` - Session-authorized Service Canvas window creation and reuse.
- `desktop/scripts/check-service-canvas-window.mjs` - Real Desktop opening, repeated activation, close/reopen, and invalid-request rejection.

- `internal/tessiven_ui/src/TessivenPage.tsx`
- `internal/tessiven_ui/src/TessivenLibraryCard.tsx`
- `internal/tessiven_ui/src/TessivenFlowerPanel.tsx`
- `internal/flower_ui/src/FlowerSurface.tsx`
- `internal/tessiven_ui/src/TessivenGraph.tsx`
- `internal/tessiven_ui/src/projection.ts`
- `internal/tessiven_ui/src/tessiven.css`
- `internal/tessiven_ui/src/transport.ts`
- `internal/tessiven/store.go`
- `internal/tessiven/store_test.go`
- `internal/codeapp/appserver/tessiven.go`
- `internal/envapp/ui_src/src/styles/tessiven.browser.test.tsx`
- `internal/envapp/ui_src/src/styles/tessiven-shared-hosts.browser.test.tsx` - Complete host inventory, linked hover/focus, original details, membership navigation, themes and projected placement.
- `internal/envapp/ui_src/src/styles/fixtures/tessiven-hadoop.json`
- `internal/envapp/ui_src/src/styles/tessiven-library.browser.test.tsx`
- `internal/envapp/ui_src/src/styles/tessiven-flower.browser.test.tsx`
- `internal/envapp/ui_src/src/ui/EnvAppShell.tsx`
- `internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx`
- `internal/envapp/ui_src/src/ui/envSidebarVisibilityMotion.ts`
