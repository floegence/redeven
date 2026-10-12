---
type: UI Contract
title: Tessiven canvas
description: Render progressively detailed service topology and exact object context.
tags: [ui, tessiven, graph]
timestamp: 2026-10-11T00:00:00Z
quality_exception: Cross-surface canvas interaction contract for Activity, standalone windows, topology browsing, and exact object actions; document, Runtime, and Flower lifecycle remain separately owned.
---
# Summary

Tessiven presents one progressively detailed canvas for understanding where
business services run. Solid Runtime node cards sit inside tinted dashed visual
groups; external dependencies use a separate card treatment. Default connections
show root-level overview; hover and focus show only the current group or host's
relationships. Wheel zoom and drag pan belong to
the canvas, while object details and the read-only document remain normal selectable
text. Flower is the editing surface; the canvas has no manual content editor.

# Contract

The Connected environments panel and Runtime node details follow the
[scoped Runtime operations contract](../ai/tessiven-runtime-operations.md).
They share the official service with Flower and preserve reading state on refresh.

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

Layout, routing, view controls and large-graph rendering follow the
[canvas navigation and rendering contract](tessiven-canvas-navigation.md).

- The library uses one toolbar with search, direct creation, and a secondary
  menu for archived canvases. It has no extra heading, archive tab, or status
  bar. New canvas immediately creates and opens an empty saved canvas.
- Each library card previews the current saved document through the same
  projection and published Floe layout engine used by the canvas. It shows
  nodes, groups, resources, and overview relationships without creating a second
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
  The existing Flower admission handoff notifies Tessiven exactly once, whether
  an HTTP receipt or canonical current confirms first. Tessiven consumes only
  references matching the submitted canvas, version, selection nonce and ordered
  object references, then binds that original canvas to the admitted thread.
  Failed or unknown admission retains references; a newer selection remains.
  Opening the reply window stays a separate submission presentation action.
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
  shared Tessiven icon owns its paint and high-contrast stylesheet; Activity
  navigation must render it before the lazy canvas page or its stylesheet loads.
  Loading the canvas later must not change the navigation mark's paint.
  The toolbar reuses the shared resource-header sizing used by other resource
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
- Every logical group exposes a visible, labeled expand or collapse action with
  a directional icon. The action remains in the group header in both states and
  uses the same state as the projected group contents.
- Clicking opens object details. Hover shows the current connection scope under
  the navigation contract without opening explanatory UI; right-click, keyboard context menu, and touch context entry
  open Ask Flower with the exact immutable canvas/version selection.
- Every graph Ask Flower entry uses the canonical Flower bloom in a compact
  accented action, including object details, context menus and the canvas menu.
- Relations between co-located service or instance endpoints appear as compact
  source-to-target rows within the host card, rather than a group self-loop.
  Explicit instance endpoints remain exact; service-level routing stays at the
  logical aggregate without expanding every host pair. Collapsed groups show
  bounded relationship patterns; expanded headers open a pool-wide overview.
  [Relationship summaries](tessiven-relationship-summaries.md) owns aggregation,
  exact counts, paged drilldown and summary references. Exact physical-card rows
  open the original relation and evidence and reference that relation when asking Flower. A repeated host
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
  Card and group bounds budget the displayed service and relationship rows, including the
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
interaction. Native graph cards and their action rows share the same touch
owner: a tap keeps the original action, while movement becomes canvas pan and
suppresses the resulting click. Pinch anchors use canvas-local coordinates;
small pinch movement is never filtered as a tap. One/two-finger transitions
retain the rendered anchor. Fast one-finger release has bounded deceleration,
with reduced motion disabling coast; new input and view commands stop it.
Pointer cancellation, visibility changes, resize and disposal clear the
touch anchors and pending frame. Native viewport limits match the published
graph's fitted minimum, avoiding a scale jump on the first pinch. Native hosts
supply only a measured bottom occlusion inset so the shared zoom controls sit
above the floating Flower entry without shrinking the canvas. Native rendering has bounded loading and explicit retry, and never
falls back to a second layout engine.

The released Floe graph component owns pan, zoom, routing, layout, focus, and
floating-layer mechanics. Redeven owns the Tessiven projection and business
data. The graph renders the [saved version document](../architecture/tessiven-canvas-contract.md)
without introducing independent topology state. Selecting a node, group, or
historical version cannot change its management permissions. Ask Flower focuses
the canvas composer and never sends a message automatically.

## Explicit Group Packing

The shared document-to-graph mapper passes only visible container rules from
`presentation.groupLayouts` to the published Floe layout API. Main canvas and
thumbnail use the same mapper. Preferred and compact reflows preserve row/column
packing, selection anchors and complete relationships. Collapsed groups and
hidden members do not contribute child geometry. Shared host appearances follow
their respective groups; the existing large-pool aggregation remains in effect.
No additional menu or local layout engine owns these rules.

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
- `internal/envapp/ui_src/src/styles/tessiven-group-layout.browser.test.tsx` - Explicit packing, compact reflows, authored order, thumbnail parity and themes.
- `internal/envapp/ui_src/scripts/checkCanvasGroupLayoutRuntime.mjs` - Isolated Kubernetes Read/Edit regression through the real Runtime and standalone Desktop window.
- `internal/tessiven_ui/src/tessiven.css`
- `internal/tessiven_ui/src/TessivenIcon.tsx`
- `internal/envapp/ui_src/src/styles/tessiven-icons.browser.test.tsx` - Distinct silhouettes, graph/thumbnail parity, theme and high-contrast rendering.
- `internal/envapp/ui_src/src/styles/navigationIcons.browser.test.tsx` - Cold navigation paint, lazy stylesheet continuity, and actual-size theme checks.
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
