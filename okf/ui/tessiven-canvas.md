---
type: UI Contract
title: Tessiven canvas
description: Render progressively detailed service topology and exact object context.
tags: [ui, tessiven, graph]
timestamp: 2026-10-09T00:00:00Z
quality_exception: Cross-surface canvas interaction contract for Activity, standalone windows, topology browsing, and exact object actions; document, Runtime, and Flower lifecycle remain separately owned.
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

Automatic layout and library thumbnails use the same published Floe layout
engine, direction, layers, and visibility projection. Documents may declare
ordered root layers for stable left-to-right, right-to-left, top-to-bottom, or
bottom-to-top structure; unassigned roots join the nearest related layer, and
disconnected components follow deterministically. Independent members remain
readable peers inside their dashed logical group. Saved positions guide ordering
within a layer and never override its rank. Folding and expanding compact only
the visible subgraph, retain a visible selection and its world-coordinate anchor,
and anchor its containing group when the selection becomes hidden. Subsequent
host selection stays compact for that mounted canvas. The viewport center stays
unchanged, and hidden members do not contribute to bounds. Browsing
never rewrites saved hints or creates document versions. Relations retain their
original endpoints and ports; grouping never invents a relationship. Invalid
graph data and actual worker/routing failures remain visible errors.
Published Floe jointly routes packed and positioned relationships orthogonally.
Free anchors can use the available spans of all four node and dashed-group
borders, favor nearby facing spans, and separate parallel paths into lanes.
Automatic anchors include corridors alongside obstacles; the published router
chooses their borders jointly so independent calls can reach unused group spans
without being forced across each other. Automatic endpoint lanes separate
shared segments without changing explicit port or self-loop constraints.
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
  placeholder. Default whole-canvas context is implicit and stays hidden in
  the composer. It is attached only to the first send that creates a conversation.
  Follow-ups and restored conversations reuse their canonical thread context;
  removing the last object returns to an ordinary follow-up without another
  whole-canvas snapshot. Explicit object references carry the exact visible
  canvas/version through their context action and take precedence over the
  implicit initial context. Native file references remain independent.
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
- The visible version supplies initial conversation context and explicit object
  references, including historical selections. A version change or view refresh
  does not attach another implicit snapshot to subsequent messages. Starting a
  new conversation includes its current initial context again. Saved-version
  events update current views only; they do not infer completion of a Flower turn.
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
  By default, every appearance lists its complete physical service inventory,
  including services belonging to other groups. A subtle service-row accent identifies
  exact membership of the current group; shared-host markers show the number
  of groups without a tooltip. Counts, service operations and Flower references
  use canonical objects, never visual replicas.
- Hover and focus apply the same title, surface and border color to all visible
  appearances of the canonical host without opening a popup. Shared-host cards
  show a compact linked-group badge. Clicking retains the existing object-details
  popup; when the host belongs to multiple groups, its group section explicitly
  says so, shows the count, and lists each group as a locate action. Locating
  another appearance expands its group when necessary and preserves the current
  object reference; closing restores focus. Service-row clicks continue to open
  exact instance details and bound-service inspection.
- Canvas controls expand or collapse all logical groups in one compact reflow.
  They preserve the selected visible object, or its enclosing group when hidden,
  and never create a document version. The default inventory remains all host
  services; an explicit canvas selector can show only the current group's exact
  instance membership. Ungrouped hosts retain all services. Local relationship
  rows whose service endpoints are filtered out are hidden in that view only;
  canonical references and external relationships remain unchanged. This scope
  is retained with the current canvas browse state, not persisted in its DSL.
- The interactive overview uses the exact current layout and viewport, including
  collapse and service filtering. Drag its viewport rectangle to pan, click the
  overview to center, or use arrow keys and Home. Floe owns navigation and compact
  SVG rendering; Tessiven supplies its localized accessible name.
- Complete packing and routing run off the renderer thread. Nodes and routes
  outside the viewport are culled without discarding canonical graph records.
  Production qualification serves built assets and verifies the complete layout
  worker, child ELK worker and raw WASM resource closure. Large-graph
  qualification measures actual host counts, including groups of ten
  so a thousand-host fixture never silently measures only aggregate cards.
- Every logical group exposes a visible, labeled expand or collapse action with
  a directional icon. The action remains in the group header in both states and
  uses the same state as the projected group contents.
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
  appearance retains the same complete inventory and local relation rows by default.
  A titled, separated service calls/access section distinguishes relationship
  rows from service inventory. Hover or keyboard focus previews only that row's
  directional route beside its exact visible source and target services, with
  matching endpoint emphasis. Leaving or opening details clears the preview;
  it never opens a hover popup or persists layout changes. Instance endpoints
  resolve to their canonical service row. Two instances aggregated in one row
  use a loop glyph there; hidden endpoints never connect to substitute rows.
  Released Floe routes fixed local inventory geometry, measured in its own
  coordinate space so canvas zoom and projected surfaces preserve alignment.
  Row geometry is measured and observed only while a relationship is active;
  idle inventories never force layout or allocate per-card resize observers.
  Service rows retain their full inventory width without a reserved connector
  gutter. Preview routes may extend beyond the inventory and node border;
  neither the node nor its route SVG clips them. Env App, its standalone window,
  and Desktop Welcome pin the same published graph engine; each host must honor
  the preview clearance instead of silently using an older routing contract.
  Card and group bounds budget every service and relation row, including the
  expansion action, so content never spills outside its node or dashed frame.
- Theme tokens, high contrast, product locale, and accessible names are used
  for every card, edge, menu, and action.
- Every schema service and external-resource kind has a distinct semantic
  silhouette in one Tessiven icon catalog shared by the graph and thumbnails.
  Service-row icons stay unframed and use a restrained two-color palette with
  light/dark variants. High contrast preserves the silhouettes and interior
  cutouts without depending on hue. The saved fine-grained kind is authoritative.
  For generic `service` and compatible broad kinds, a bounded catalog of known
  service-name aliases refines the displayed icon (for example, containerd uses
  the container-runtime silhouette). Unrecognized names retain the saved kind;
  IDs, descriptions, and unrelated specific kinds never drive this refinement.
  This display mapping is shared by host inventories, collapsed groups, service
  summaries, and thumbnails. Legacy services without placements display an
  explicit missing-node label, not an observation status; large hosted-service
  summaries display their instance count in both graph and thumbnail. The
  [document contract](../architecture/tessiven-canvas-contract.md) prevents
  new unplaced services while keeping immutable history readable for repair.
  The display mapping never changes saved responsibilities, management
  identity, permissions, or historical documents. Separate responsibilities
  include cloud controllers, node agents, container runtimes, network plugins,
  service meshes, ingress, operators, registries, observability, identity, secret
  and certificate services, streaming, and metadata; repeated instances of the
  same responsibility keep the same icon.

# Boundaries

The iOS host bundles the shared TessivenGraph and the published Floe graph engine
as fixed application resources. `buildNativeServiceCanvas.mjs` exports the browser
Solid entry, published Floe blob layout/ELK workers and independently replaceable raw
libavoid WebAssembly, dependency licenses and corresponding source, plus a hash manifest tied to the
Redeven source commit. The local CSP permits the published Emscripten function
constructors; scripts, layout assets and worker code remain bundled, with no
remote script or frame source. This is WebKit document execution, not native
code download or a native JIT.

The host supplies saved-version data and theme through one update function.
Native hosts retain their zoom toolbar and minimap. Group expansion and hosted
service filtering belong to the native More menu; there is no duplicate graph
toolbar. A canvas/version-bound command bridge delegates to the shared graph,
which reports the available actions and current service scope.
The data-only bridge reports loading, rendered, failure, or an immutable object
selection; iOS validates the canvas, version and referenced objects before
opening native details or Flower. Library, history, document export and API
authorization remain native-owned. No credential or session transport is
exposed to the renderer. The native touch adapter owns one- and two-finger input exclusively, updating
the shared viewport once per animation frame. It does not also start the
published mouse drag session, whose private viewport defers external updates
until release. Mouse, wheel, minimap and layout retain the published graph
interaction. Pointer cancellation, visibility changes and disposal clear the
touch anchors and pending frame. Native rendering has bounded loading and explicit retry, and never
falls back to a second layout engine.

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
- `internal/tessiven_ui/src/native/entry.tsx`
- `internal/envapp/ui_src/scripts/buildNativeServiceCanvas.mjs`
- `scripts/check_native_service_canvas.mjs` - Offline custom-scheme WebKit qualification for shared group controls, service scope, minimap geometry and explicit renderer failure.
- `internal/tessiven_ui/src/TessivenServiceRelations.tsx`
- `internal/tessiven_ui/src/projection.ts`
- `internal/tessiven_ui/src/tessiven.css`
- `internal/tessiven_ui/src/TessivenIcon.tsx`
- `internal/envapp/ui_src/src/styles/tessiven-icons.browser.test.tsx` - Distinct silhouettes, graph/thumbnail parity, theme and high-contrast rendering.
- `internal/tessiven_ui/src/transport.ts`
- `internal/tessiven/store.go`
- `internal/tessiven/store_test.go`
- `internal/codeapp/appserver/tessiven.go`
- `internal/envapp/ui_src/src/styles/tessiven.browser.test.tsx`
- `internal/envapp/ui_src/src/styles/tessiven-scale.browser.test.tsx` - Explicit 100, 500 and 1,000 physical host qualification, renderer long tasks, navigation frame time and compact visibility.
- `internal/envapp/ui_src/src/styles/tessiven-shared-hosts.browser.test.tsx` - Complete host inventory, linked hover/focus, original details, membership navigation, themes and projected placement.
- `internal/envapp/ui_src/src/styles/fixtures/tessiven-hadoop.json`
- `internal/envapp/ui_src/src/styles/tessiven-library.browser.test.tsx`
- `internal/envapp/ui_src/src/styles/tessiven-flower.browser.test.tsx`
- `internal/envapp/ui_src/src/ui/EnvAppShell.tsx`
- `internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx`
- `internal/envapp/ui_src/src/ui/envSidebarVisibilityMotion.ts`
