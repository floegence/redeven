import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  batch,
  onCleanup,
  onMount,
  untrack,
  type JSX,
} from 'solid-js';
import {
  GraphCanvas,
  createGraphLayoutEngine,
  fitGraphViewport,
  type GraphLayout,
  type GraphLayoutNode,
  type GraphLayoutEdge,
  type GraphNodeRenderContext,
  type GraphObjectEvent,
  type GraphObjectRef,
} from '@floegence/floe-webapp-core/graph';
import { Button, Dropdown, SurfaceFloatingLayer } from '@floegence/floe-webapp-core/ui';
import { ChevronDown, ChevronUp, Link, ExternalLink, Layers, Maximize, Minus, Plus, MoreHorizontal } from '@floegence/floe-webapp-core/icons';
import '@floegence/floe-webapp-core/graph.css';
import { projectCanvas, projectLayoutOptions, type NodeServiceScope, type Projection } from './projection';
import { TessivenIcon } from './TessivenIcon';
import { projectOverviewConnections, projectNodeConnections } from './connections';
import { TessivenRelationDetails } from './TessivenRelationDetails';
import { summarizeRelations, summaryReferences, type RelationSummary } from './relations';
import { TessivenServiceRelations, type ServiceRelationEndpoint } from './TessivenServiceRelations';
import { FlowerIcon } from '../../flower_ui/src/icons/FlowerIcon';
import type {
  Instance,
  Observation,
  Selection,
  TessivenText,
  RenderVersion,
} from './types';

export type ResourceAction =
  | 'inspect'
  | 'logs'
  | 'open'
  | 'start'
  | 'stop'
  | 'restart';
export type GraphBrowseState = {
  expanded: string[];
  selectedNodes: Record<string, string>;
  viewport: { x: number; y: number; scale: number };
  serviceScope?: NodeServiceScope;
};
export type TessivenViewOptions = {
  hasGroups: boolean;
  canExpand: boolean;
  canCollapse: boolean;
  serviceScope: NodeServiceScope;
};
export type TessivenViewportControl = {
  zoom: (factor: number, x: number, y: number, dx?: number, dy?: number) => void;
  pan: (dx: number, dy: number) => void;
  fit: () => void;
  expandAll: () => void;
  collapseAll: () => void;
  setServiceScope: (scope: NodeServiceScope) => void;
  clearSelection: () => void;
};
export function TessivenGraph(props: {
  version: RenderVersion;
  historical: boolean;
  t: TessivenText;
  onAsk: (selection: Selection) => void;
  askReferenceMode?: 'display' | 'source';
  onInspect: (instance: Instance) => void;
  onInspectRuntime?: (runtimeRef:string)=>void;
  locate?: string;
  visible?: boolean;
  browseState?: GraphBrowseState;
  onBrowseState?: (state: GraphBrowseState) => void;
  onSelectionChange?: (selection: Selection) => void;
  onViewportControl?: (control: TessivenViewportControl) => void;
  onRenderState?: (state: 'loading' | 'rendered' | 'error') => void;
  tools?: 'all' | 'hidden';
  onViewOptions?: (options: TessivenViewOptions) => void;
  onZoomChange?: (scale: number) => void;
}) {
  const [expanded, setExpanded] = createSignal(
    new Set(
      props.browseState?.expanded ??
        props.version.view.model.presentation?.initiallyExpanded ??
        [],
    ),
  );
  const [selectedNodes, setSelectedNodes] = createSignal<
    Record<string, string>
  >(props.browseState?.selectedNodes ?? {});
  const [serviceScope, setServiceScope] = createSignal<NodeServiceScope>(props.browseState?.serviceScope ?? 'all');
  const [layoutPending, setLayoutPending] = createSignal(false);
  const [viewport, setViewport] = createSignal(
    props.browseState?.viewport ?? { x: 40, y: 40, scale: 1 },
  );
  const [layout, setLayout] = createSignal<GraphLayout>({
    nodes: [],
    edges: [],
    bounds: { x: 0, y: 0, width: 1, height: 1 },
  });
  const [selectionState, setSelectionState] = createSignal<{ object: GraphObjectRef | null; refs: string[] }>({ object: null, refs: [] });
  const selected = () => selectionState().object;
  const [connectionFocus, setConnectionFocus] = createSignal<GraphObjectRef | null>(null);
  const [visibleRoutes, setVisibleRoutes] = createSignal<readonly GraphLayoutEdge[]>([]);
  const [routingPending, setRoutingPending] = createSignal(false);
  const routeCache = new Map<string, readonly GraphLayoutEdge[]>();
  let displayedEdges = new Set<string>();
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  let pointerPressed = false;
  const [popup, setPopup] = createSignal<{
    event: GraphObjectEvent;
    refs: string[];
    menu: boolean;
    summary?: { refs: string[]; title?: string; summaries: readonly RelationSummary[]; key?: string };
  } | null>(null);
  const [error, setError] = createSignal('');
  const engine = createGraphLayoutEngine();
  let generation = 0,
    initialized = !!props.browseState;
  let previousExpanded = new Set(expanded());
  let positionMode: 'preferred' | 'compact' = 'preferred';
  let host: HTMLDivElement | undefined;
  const zoomAt = (factor: number, x: number, y: number, dx = 0, dy = 0) => {
    close();
    setViewport(previous => {
      const scale = Math.max(0.1, Math.min(3, previous.scale * factor));
      const ratio = scale / previous.scale;
      return { scale, x: x - (x - previous.x) * ratio + dx, y: y - (y - previous.y) * ratio + dy };
    });
  };
  onCleanup(() => { generation += 1; clearTimeout(leaveTimer); engine.dispose(); });
  onMount(() => {
    const down = (event: PointerEvent) => { pointerPressed = event.composedPath().includes(host!); };
    const up = () => { pointerPressed = false; };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    onCleanup(() => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
    });
  });
  onMount(() => props.onViewportControl?.({
    fit,
    expandAll: () => toggleAll(true),
    collapseAll: () => toggleAll(false),
    setServiceScope: updateServiceScope,
    clearSelection: () => { select(null); close(); },
    pan(dx, dy) {
      close();
      setViewport(previous => ({ ...previous, x: previous.x + dx, y: previous.y + dy }));
    },
    zoom: zoomAt,
  }));
  createEffect(() => props.onZoomChange?.(viewport().scale));
  const zoom = (factor: number) => zoomAt(factor, (host?.clientWidth ?? 0) / 2, (host?.clientHeight ?? 0) / 2);
  createEffect(() => {
    const groups = props.version.view.model.groups ?? [];
    props.onViewOptions?.({
      hasGroups: groups.length > 0,
      canExpand: groups.some(group => !expanded().has(group.id)),
      canCollapse: groups.some(group => expanded().has(group.id)),
      serviceScope: serviceScope(),
    });
  });
  onCleanup(() => {
    // Empty canvases have no meaningful viewport to restore after Flower maps them.
    if (!layout().nodes.length) return;
    props.onBrowseState?.({
      expanded: [...expanded()],
      selectedNodes: selectedNodes(),
      viewport: viewport(),
      serviceScope: serviceScope(),
    });
  });
  const requestedProjection = createMemo(() =>
    projectCanvas(props.version.view.model, expanded(), selectedNodes(), serviceScope()),
  );
  const [renderedProjection, setRenderedProjection] = createSignal<Projection>();
  const projection = () => renderedProjection() ?? requestedProjection();
  const groupTones = createMemo(() => new Map(
    (props.version.view.model.groups ?? []).map((group, index) => [group.id, index % 4]),
  ));
  const resourceTone = (kind: string) => ['domain', 'cdn', 'load_balancer'].includes(kind) ? 'network' : 'storage';
  const minimapStyle = (node: GraphLayoutNode) => {
    const card = projection().cards.get(node.id);
    if (card?.kind === 'group') return {
      fill: `color-mix(in oklab, var(--ts-group-${groupTones().get(node.id) ?? 0}) 82%, var(--background))`,
      stroke: 'var(--ts-group-line)',
    };
    if (card?.kind === 'resource') {
      const color = `--ts-${resourceTone(card.resource.kind)}`;
      return {
        fill: `color-mix(in oklab, var(${color}) 43%, var(--card))`,
        stroke: `color-mix(in oklab, var(${color}) 70%, var(--foreground))`,
      };
    }
    return {
      fill: 'var(--ts-node)',
      stroke: 'color-mix(in oklab, var(--ts-node) 70%, var(--foreground))',
    };
  };
  const linkedNode = createMemo(() => {
    const object = connectionFocus() ?? selected();
    const card = object?.kind === 'node' ? projection().cards.get(object.id) : undefined;
    return card?.kind === 'node' ? card.node.id : undefined;
  });
  const canonicalRef = (id: string) => {
    const card = projection().cards.get(id);
    return card?.kind === 'node' ? card.node.id : id;
  };
  const appearance = (nodeId: string, groupId?: string) =>
    requestedProjection().appearances.get(nodeId)?.find(id => {
      const card = requestedProjection().cards.get(id);
      return card?.kind === 'node' && (!groupId || card.group?.id === groupId);
    });
  const allObjects = createMemo(
    () =>
      new Map(
        [
          'nodes',
          'groups',
          'services',
          'instances',
          'resources',
          'relations',
          'evidence',
          'objects',
        ].flatMap((kind) =>
          (
            (
              props.version.view.model as unknown as Record<
                string,
                { id: string }[]
              >
            )[kind] ?? []
          ).map((value) => [value.id, value] as const),
        ),
      ),
  );
  const services = createMemo(
    () =>
      new Map(
        (props.version.view.model.services ?? []).map((service) => [
          service.id,
          service,
        ]),
      ),
  );
  const fit = () => {
    if (host)
      setViewport(
        fitGraphViewport(
          layout().bounds,
          { width: host.clientWidth, height: host.clientHeight },
          56,
        ),
      );
  };
  createEffect(() => {
    const projected = requestedProjection();
    props.onRenderState?.('loading');
    const currentExpanded = expanded();
    if (
      currentExpanded.size !== previousExpanded.size ||
      [...currentExpanded].some(id => !previousExpanded.has(id))
    ) positionMode = 'compact';
    previousExpanded = new Set(currentExpanded);
    const input = projected.graph;
    untrack(resetConnections);
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    const id = ++generation;
    setLayoutPending(true);
    const anchor = untrack(() => {
      const previous = layout().nodes;
      const selectedNode = previous.find(node => node.id === selected()?.id);
      const selectedVisible = projected.graph.nodes.some(node => node.id === selectedNode?.id);
      const target = selectedVisible
        ? selectedNode
        : selectedNode?.parentId
          ? previous.find(node => node.id === selectedNode.parentId)
          : undefined;
      return target && projected.graph.nodes.some(node => node.id === target.id) ? target : undefined;
    });
    void engine
      .layout(input, {
        ...projectLayoutOptions(props.version.view.model, projected, positionMode),
        routing: 'none',
        anchor: anchor
          ? { nodeId: anchor.id, position: { x: anchor.x, y: anchor.y } }
          : undefined,
      })
      .then(async (geometry) => {
        if (id !== generation) return;
        const overview = projectOverviewConnections(projected);
        const edges = await engine.route(geometry, overview.edges, {}, { signal: controller.signal });
        if (id !== generation || controller.signal.aborted) return;
        const next = { ...geometry, edges };
        routeCache.clear();
        batch(() => {
          setRenderedProjection(projected);
          setLayout(next);
          if (!initialized && host) {
            initialized = true;
            setViewport(fitGraphViewport(next.bounds, { width: host.clientWidth, height: host.clientHeight }, 56));
          }
        });
        setError('');
        props.onRenderState?.('rendered');
        setLayoutPending(false);
        centerSelection();
      })
      .catch((cause: unknown) => {
        if (id === generation && !controller.signal.aborted) {
          setError(String(cause));
          setLayoutPending(false);
          props.onRenderState?.('error');
        }
      });
  });
  const overviewConnections = createMemo(() => projectOverviewConnections(projection()));
  const connections = createMemo(() => {
    const focus = connectionFocus();
    if (!focus) return overviewConnections();
    const card = projection().cards.get(focus.id);
    if (card?.kind === 'node') return projectNodeConnections(projection(), focus.id);
    const overview = overviewConnections();
    return { ...overview, edges: overview.edges.filter(edge => edge.source === focus.id || edge.target === focus.id) };
  });
  const shownLayout = createMemo(() => ({ ...layout(), edges: visibleRoutes().map(edge => {
    const values = connections().relations.get(edge.id) ?? [];
    return { ...edge, label: values.length > 1 ? String(values.length)
      : values[0]?.protocol ?? (values[0] ? props.t(`relation.${values[0].kind}`) : edge.label) };
  }) }));
  createEffect(() => {
    const geometry = layout(), current = connections(), focus = connectionFocus();
    if (!geometry.nodes.length) { setVisibleRoutes([]); return; }
    const isNode = focus && projection().cards.get(focus.id)?.kind === 'node';
    if (!isNode) {
      const ids = new Set(current.edges.map(edge => edge.id));
      setVisibleRoutes(geometry.edges.filter(edge => ids.has(edge.id)));
      setRoutingPending(false); return;
    }
    const key = focus.id;
    const cached = routeCache.get(key);
    if (cached) {
      routeCache.delete(key); routeCache.set(key, cached);
      setVisibleRoutes(cached); setRoutingPending(false); return;
    }
    setVisibleRoutes([]);
    if (!current.edges.length) { setRoutingPending(false); return; }
    const controller = new AbortController(), revision = generation;
    setRoutingPending(true);
    onCleanup(() => controller.abort());
    void engine.route(geometry, current.edges, {}, { signal: controller.signal }).then(routes => {
      if (controller.signal.aborted || revision !== generation) return;
      routeCache.set(key, routes);
      if (routeCache.size > 32) routeCache.delete(routeCache.keys().next().value!);
      batch(() => { setVisibleRoutes(routes); setRoutingPending(false); setError(''); });
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted && revision === generation) { setRoutingPending(false); setError(String(cause)); }
    });
  });
  createEffect(() => {
    const next = new Set(visibleRoutes().map(edge => edge.id));
    const entering = new Set([...next].filter(id => !displayedEdges.has(id)));
    displayedEdges = next;
    if (!entering.size || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    queueMicrotask(() => {
      if (!host?.isConnected) return;
      for (const element of host.querySelectorAll<SVGElement>('.floe-graph__edges > g'))
        if (entering.has(element.dataset.graphObject!))
          element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
    });
  });
  function retainConnections() { clearTimeout(leaveTimer); leaveTimer = undefined; }
  function resetConnections() { retainConnections(); setConnectionFocus(null); }
  function leaveConnections() {
    retainConnections();
    if (popup()) return;
    leaveTimer = setTimeout(() => { leaveTimer = undefined; setConnectionFocus(null); }, 120);
  }
  function hoverConnections(object: GraphObjectRef | null) {
    if (pointerPressed) return;
    if (!object) { leaveConnections(); return; }
    retainConnections();
    if (object.kind === 'edge') return;
    if (connectionFocus()?.id !== object.id) setConnectionFocus(object);
  }
  let pendingLocate: string | undefined;
  const centerSelection = () => {
    if (!pendingLocate || !host) return;
    const target = layout().nodes.find((node) => node.id === pendingLocate);
    if (!target) return;
    const scale = Math.min(viewport().scale, 1);
    setViewport({
      scale,
      x: host.clientWidth / 2 - (target.x + target.width / 2) * scale,
      y: host.clientHeight / 2 - (target.y + target.height / 2) * scale,
    });
    pendingLocate = undefined;
  };
  createEffect(() => {
    if (props.visible === false) close();
  });
  createEffect(() => {
    const id = props.locate;
    if (!id || !host) return;
    const document = props.version.view.model;
    const relation = document.relations?.find(
      (value) => value.id === id || value.evidenceRefs.includes(id),
    );
    const endpoint = relation?.from ?? id;
    const instance = document.instances?.find(
      (value) => value.id === endpoint || value.serviceRef === endpoint,
    );
    const nodeID = instance?.nodeRef ?? endpoint;
    untrack(() => {
      const group = instance
        ? projection().instanceMemberships.get(instance.id)?.[0]
        : projection().memberships.get(nodeID)?.[0];
      if (group) {
        setExpanded((previous) => new Set([...previous, group.id]));
        setSelectedNodes((previous) => ({ ...previous, [group.id]: nodeID }));
      }
      const viewID = appearance(nodeID, group?.id) ?? nodeID;
      select({ kind: 'node', id: viewID });
      pendingLocate = viewID;
      centerSelection();
      const bounds = host!.getBoundingClientRect();
      show(
        {
          object: { kind: 'node', id: viewID },
          owner: host!,
          position: { x: bounds.left + bounds.width / 2, y: bounds.top + 60 },
        },
        [id],
      );
    });
  });
  function close(restore = false) {
    const owner = popup()?.event.owner;
    setPopup(null);
    leaveConnections();
    if (restore) {
      const object = selected();
      const target = owner instanceof HTMLElement && owner.isConnected && owner.matches('button, a, input, select, textarea, [tabindex]')
        ? owner : object?.kind === 'node' ? host?.querySelector<HTMLElement>(`[data-graph-object="${object.id}"]`) : undefined;
      target?.focus({ preventScroll: true });
    }
  }
  function select(object: GraphObjectRef | null, refs?: string[]) {
    const selectionRefs = refs ?? (object?.kind === 'edge'
      ? connections().relations.get(object.id)?.map(value => value.id) ?? []
      : object ? [canonicalRef(object.id)] : []);
    const selection: Selection = { canvas_id: props.version.canvas_id, version_id: props.version.number, object_refs: selectionRefs.slice(0, 100) };
    setSelectionState({ object, refs: selectionRefs });
    props.onSelectionChange?.(selection);
    return { ...selection, object_refs: selectionRefs };
  }
  function askableRefs(refs: string[]) {
    return [...new Set(refs.flatMap(id => {
      const object = props.version.view.model.objects?.find(value => value.id === id);
      return object ? object.objectRefs ?? [] : [id];
    }))];
  }
  function askRefs(refs: string[]) {
    return props.askReferenceMode === 'display' ? refs : askableRefs(refs);
  }
  function canAsk(refs: string[]) {
    return !refs.length || askableRefs(refs).length > 0;
  }
  function show(event: GraphObjectEvent, refs?: string[], menu = false) {
    if (!refs && event.object?.kind === 'edge') {
      const edge = connections().edges.find(value => value.id === event.object!.id);
      const relations = connections().relations.get(event.object.id) ?? [];
      if (edge && (edge.id.startsWith('@overview/') || relations.length > 1)) {
        const scope = [...new Set([canonicalRef(edge.source), canonicalRef(edge.target)])];
        const details = relations.map(value => projection().relationDetails.get(value.id)!);
        const summaries = summarizeRelations(details, new Set(details.flatMap(value => value.nodeRefs)));
        select(event.object, scope); retainConnections();
        if (menu) { show(event, scope, true); return; }
        setPopup({ event, refs: scope, menu: false, summary: { refs: scope,
          title: `${projection().graph.nodes.find(node => node.id === edge.source)?.label ?? edge.source} → ${projection().graph.nodes.find(node => node.id === edge.target)?.label ?? edge.target}`, summaries } });
        return;
      }
    }
    if (event.object?.kind === 'node') { retainConnections(); setConnectionFocus(event.object); }
    const selection = select(event.object, refs);
    const selectionRefs = selection.object_refs;
    if (props.onSelectionChange) {
      if (menu && canAsk(selectionRefs)) props.onAsk({ ...selection, object_refs: askRefs(selectionRefs).slice(0, 100) });
      return;
    }
    setPopup({
      event,
      refs: selectionRefs,
      menu,
    });
  }
  function ask(refs: string[]) {
    if (!canAsk(refs)) return;
    if (refs.length > 100) {
      const object = popup()?.event.object;
      const edge =
        object?.kind === 'edge'
          ? connections().edges.find((edge) => edge.id === object.id)
          : undefined;
      refs = edge ? [canonicalRef(edge.source), canonicalRef(edge.target)] : object ? [canonicalRef(object.id)] : [];
    }
    close();
    props.onAsk({
      canvas_id: props.version.canvas_id,
      version_id: props.version.number,
      object_refs: askRefs(refs).slice(0, 100),
    });
  }
  function toggle(id: string) {
    const current = selected();
    const node = current?.kind === 'node'
      ? projection().graph.nodes.find(node => node.id === current.id)
      : undefined;
    if (!node || (expanded().has(id) && node.parentId === id))
      select({ kind: 'node', id });
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    close();
  }
  function updateServiceScope(scope: NodeServiceScope) {
    if (scope === serviceScope()) return;
    positionMode = 'compact';
    close();
    if (props.onSelectionChange) select(null);
    setServiceScope(scope);
  }
  function toggleAll(open: boolean) {
    const current = selected();
    const node = current?.kind === 'node' ? projection().graph.nodes.find(node => node.id === current.id) : undefined;
    if (!open && node?.parentId) select({ kind: 'node', id: node.parentId });
    setExpanded(new Set(open ? (props.version.view.model.groups ?? []).map(group => group.id) : []));
    close();
  }
  function locateNode(nodeId: string, groupId: string) {
    setExpanded(previous => new Set([...previous, groupId]));
    setSelectedNodes(previous => ({ ...previous, [groupId]: nodeId }));
    const id = appearance(nodeId, groupId)!;
    select({ kind: 'node', id });
    pendingLocate = id;
    centerSelection();
    const current = popup();
    if (current) setPopup({ ...current, event: { ...current.event, object: { kind: 'node', id }, owner: host! } });
  }
  const rowEvent = (
    event: MouseEvent | KeyboardEvent,
    id: string,
  ): GraphObjectEvent => {
    const owner = event.currentTarget as Element;
    const rect = owner.getBoundingClientRect();
    const pointer = event instanceof MouseEvent && event.detail !== 0;
    return {
      object: { kind: 'node', id },
      owner,
      position: pointer
        ? { x: event.clientX, y: event.clientY }
        : { x: rect.left + 12, y: rect.bottom },
    };
  };
  const keyboardMenu = (event: KeyboardEvent, id: string, refs = [canonicalRef(id)]) => {
    if (
      event.key === 'ContextMenu' ||
      (event.shiftKey && event.key === 'F10')
    ) {
      event.preventDefault();
      event.stopPropagation();
      show(rowEvent(event, id), refs, true);
    }
  };
  const serviceRows = (instances: Instance[], limit = Infinity, ownerId?: string, endpoint?: (id: string) => ServiceRelationEndpoint | undefined): JSX.Element => {
    const owner = ownerId ? projection().cards.get(ownerId) : undefined;
    const grouped = owner?.kind === 'node' && owner.group?.instanceRefs ? new Set(owner.groupInstances.map(instance => instance.id)) : undefined;
    const serviceIDs = [
      ...new Set(instances.map((instance) => instance.serviceRef)),
    ];
    return (
      <>
        <For each={serviceIDs.slice(0, limit)}>
          {(id) => {
            const service = () => services().get(id),
              members = instances.filter(
                (instance) => instance.serviceRef === id,
              );
            const groups = [...new Map(members.flatMap(instance => projection().instanceMemberships.get(instance.id) ?? []).map(group => [group.id, group])).values()];
            const caption = () => owner?.kind === 'node' && (projection().memberships.get(owner.node.id)?.length ?? 0) > 1 && groups.length
              ? [...groups.map(group => group.name), ...new Set(members.map(instance => props.t(`role.${instance.role}`)))].join(' · ')
              : props.t(`kind.${service()?.kind ?? 'service'}`);
            return (
              <button
                class="tessiven-service"
                data-service-id={id}
                data-selected={props.onSelectionChange && members.some(instance => selectionState().refs.includes(instance.id)) ? 'true' : undefined}
                data-relation-endpoint={endpoint?.(id)}
                data-kind={service()?.kind}
                data-member={grouped ? members.some(instance => grouped.has(instance.id)) : undefined}
                onKeyDown={(event) => keyboardMenu(event, ownerId ?? id, [id])}
                onClick={(event) => {
                  event.stopPropagation();
                  show(
                    rowEvent(event, ownerId ?? id),
                    members.map((instance) => instance.id),
                  );
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  show(rowEvent(event, ownerId ?? id), [id], true);
                }}
              >
                <TessivenIcon kind={service()?.kind ?? 'service'} name={service()?.name} />
                <span>
                  <strong>{service()?.name ?? id}</strong>
                  <small>
                    {caption()}
                  </small>
                </span>
                <span class="tessiven-count">×{members.length}</span>
              </button>
            );
          }}
        </For>
        <Show when={serviceIDs.length > limit}>
          <button
            class="tessiven-more"
            onClick={(event) =>
              show(
                rowEvent(event, instances[0]!.nodeRef),
                instances.map((instance) => instance.id),
              )
            }
          >
            {props.t('moreServices', { count: serviceIDs.length - limit })}
          </button>
        </Show>
      </>
    );
  };
  const serviceInventory = (ownerId: string, instances: Instance[], limit = Infinity, group = false): JSX.Element => (
    <TessivenServiceRelations relations={projection().internalRelations.get(ownerId) ?? []} engine={engine} t={props.t} group={group}
      summaries={group ? projection().groupRelations.get(ownerId) : undefined}
      onSummaryActivate={(event, summary) => openSummary(event, ownerId, summary)}
      onSummaryContextMenu={(event, summary) => openSummary(event, ownerId, summary, true)}
      onSummaryKeyDown={(event, summary) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openSummary(event, ownerId, summary, true);
      }}
      onShowAll={event => openSummary(event, ownerId)}
      renderServices={endpoint => serviceRows(instances, limit, ownerId, endpoint)}
      onKeyDown={(event, id) => keyboardMenu(event, id, [id])}
      onActivate={(event, id) => { event.stopPropagation(); show(rowEvent(event, id), [id]); }}
      onContextMenu={(event, id) => { event.preventDefault(); event.stopPropagation(); show(rowEvent(event, id), [id], true); }}
      onError={cause => setError(cause instanceof Error ? cause.message : String(cause))} />
  );
  const renderCard = (
    node: GraphLayoutNode,
    context: GraphNodeRenderContext,
  ) => {
    const card = projection().cards.get(node.id);
    if (!card) return null;
    if (card.kind === 'group')
      return (
        <section
          class="tessiven-group"
          data-tone={groupTones().get(node.id) ?? 0}
          data-expanded={card.expanded}
        >
          <header>
            <span class="tessiven-group-mark" />
            <strong>{card.group.name}</strong>
            <span class="tessiven-count">{card.nodes.length}</span>
            <button
              class="tessiven-group-toggle"
              onClick={() => toggle(node.id)}
              aria-label={props.t(card.expanded ? 'collapse' : 'expand')}
              aria-expanded={card.expanded}
            >
              <ChevronDown aria-hidden="true" />
              <span>{props.t(card.expanded ? 'collapse' : 'expand')}</span>
            </button>
            <button
              onClick={context.openMenu}
              aria-label={props.t('objectMenu')}
            >
              ⋯
            </button>
          </header>
          <div class="tessiven-group-caption">
            <Show when={card.expanded && projection().groupRelations.get(node.id)?.length} fallback={<span>{props.t('logicalGroup')}</span>}>
              <button type="button" class="tessiven-pool-relations" onClick={event => openSummary(event, node.id)}>
                <Link aria-hidden="true" />{props.t('poolRelationPatterns', { count: projection().groupRelations.get(node.id)!.length })}
              </button>
            </Show>
            <span>{props.t('nodeCount', { count: card.nodes.length })}</span>
          </div>
          <Show when={card.expanded && card.aggregated}>
            <label class="tessiven-node-selector">
              <span>{props.t('selectedNode')}</span>
              <select
                value={card.selectedNode}
                onChange={(event) =>
                  setSelectedNodes((previous) => ({
                    ...previous,
                    [node.id]: event.currentTarget.value,
                  }))
                }
              >
                <For each={card.nodes}>
                  {(member, index) => (
                    <option value={member.id}>
                      #{index() + 1} · {member.name}
                    </option>
                  )}
                </For>
              </select>
            </label>
          </Show>
          <Show when={!card.expanded}>
            {serviceInventory(node.id, card.instances, 8, true)}
          </Show>
        </section>
      );
    if (card.kind === 'node')
      return (
        <section class="tessiven-node" data-node-id={card.node.id} data-group-id={card.group?.id} data-linked={linkedNode() === card.node.id}>
          <header>
            <TessivenIcon kind="node" />
            <span>
              <strong>{card.node.name}</strong>
              <small>{card.node.id}</small>
            </span>
            <Show when={(projection().memberships.get(card.node.id)?.length ?? 0) > 1}>
              <span class="tessiven-shared-host" role="img" aria-label={props.t('sharedHost', { count: projection().memberships.get(card.node.id)!.length })}>
                <Link aria-hidden="true" />
                <span>{props.t('sharedHostBadge', { count: projection().memberships.get(card.node.id)!.length })}</span>
              </span>
            </Show>
            <button
              onClick={context.openMenu}
              aria-label={props.t('objectMenu')}
            >
              ⋯
            </button>
          </header>
          <div class="tessiven-node-body">
            <button
              class="tessiven-runtime"
              onKeyDown={(event) => keyboardMenu(event, node.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                show(rowEvent(event, node.id), [card.node.id], true);
              }}
              onClick={(event) => {
                event.stopPropagation();
                if (props.onInspectRuntime) props.onInspectRuntime(card.node.runtimeRef);
                else show(rowEvent(event, node.id), [card.node.id]);
              }}
            >
              <span class="tessiven-runtime-mark">r.</span>
              <span>{props.t('redevenRuntime')}</span>
              <small>
                {props.t(`state.${card.node.observation?.state ?? 'unknown'}`)}
              </small>
            </button>
            <div class="tessiven-node-caption">
              {props.t('hostedServices')}
              <span>{card.instances.length}</span>
            </div>
            {serviceInventory(node.id, card.instances)}
          </div>
        </section>
      );
    if (card.kind === 'object')
      return (
        <section class="tessiven-resource tessiven-generic-object" data-resource="storage">
          <header><span>{card.object.kind}</span><button onClick={context.openMenu} aria-label={props.t('objectMenu')}>⋯</button></header>
          <div class="tessiven-resource-name"><TessivenIcon kind="tessiven" /><span><strong>{card.object.name}</strong><small>{card.object.id}</small></span></div>
          <Show when={card.object.description}><p>{card.object.description}</p></Show>
          <dl class="tessiven-object-facts"><For each={card.object.facts?.slice(0, 3)}>{fact => <div><dt>{fact.label}</dt><dd>{fact.value}</dd></div>}</For></dl>
        </section>
      );
    if (card.kind === 'resource')
      return (
        <section
          class="tessiven-resource"
          data-resource={resourceTone(card.resource.kind)}
        >
          <header>
            <span>{props.t(`kind.${card.resource.kind}`)}</span>
            <button
              onClick={context.openMenu}
              aria-label={props.t('objectMenu')}
            >
              ⋯
            </button>
          </header>
          <div class="tessiven-resource-name">
            <TessivenIcon kind={card.resource.kind} />
            <span>
              <strong>{card.resource.name}</strong>
              <small>{props.t('externalResource')}</small>
            </span>
          </div>
          <footer>
            <span>{props.t('endpoint')}</span>
            <code>{card.resource.endpoint ?? '—'}</code>
          </footer>
        </section>
      );
    return (
      <section class="tessiven-unplaced" data-placement={card.instanceCount ? 'hosted' : 'missing'}>
        <TessivenIcon kind={card.service.kind} name={card.service.name} />
        <strong>{card.service.name}</strong>
        <small>
          {card.instanceCount
            ? `${props.t('collection.instances')} · ${card.instanceCount}`
            : props.t('unplacedService')}
        </small>
        <button onClick={context.openMenu} aria-label={props.t('objectMenu')}>
          ⋯
        </button>
      </section>
    );
  };
  const renderDetails = (refs: string[], event: GraphObjectEvent): JSX.Element => (
                <For each={refs.slice(0, 30)}>
                  {(id) => {
                    const item = allObjects().get(id) as
                      | (Record<string, unknown> & { id: string })
                      | undefined;
                    const instance = props.version.view.model.instances?.find(
                      (member) => member.id === id,
                    );
                    const title = String(
                      item?.name ??
                        (instance
                          ? services().get(instance.serviceRef)?.name
                          : undefined) ??
                        id,
                    );
                    const related = (
                      props.version.view.model.relations ?? []
                    ).filter(
                      (relation) =>
                        relation.id === id ||
                        relation.from === id ||
                        relation.to === id ||
                        (instance &&
                          (relation.from === instance.serviceRef ||
                            relation.to === instance.serviceRef)),
                    );
                    const evidenceRefs = [
                      ...new Set([
                        ...(item && 'source' in item ? [id] : []),
                        ...((item?.observation as Observation | undefined)
                          ?.evidenceRefs ?? []),
                        ...related.flatMap((relation) => relation.evidenceRefs),
                      ]),
                    ];
                    const hosted =
                      props.version.view.model.instances?.filter(
                        (member) =>
                          member.serviceRef === id || member.nodeRef === id,
                      ) ?? [];
                    const relatedGroups = instance ? projection().instanceMemberships.get(instance.id) ?? [] : projection().memberships.get(id) ?? [];
                    const belongsToMultipleGroups = relatedGroups.length > 1;
                    return (
                      <section class="tessiven-detail-object">
                        <strong>{title}</strong>
                        <code>{id}</code>
                        <Show when={item && 'facts' in item}>
                          <dl class="tessiven-object-facts"><For each={item?.facts as { label: string; value: string }[] | undefined}>{fact => <div><dt>{fact.label}</dt><dd>{fact.value}</dd></div>}</For></dl>
                        </Show>
                        <Show when={item?.description}>
                          <p>{String(item?.description)}</p>
                        </Show>
                        <Show
                          when={item?.observation as Observation | undefined}
                          keyed
                        >
                          {(observation) => (
                            <p>
                              {props.t(`state.${observation.state}`)} ·{' '}
                              <time>{observation.observedAt}</time>
                            </p>
                          )}
                        </Show>
                        <For each={hosted.slice(0, 30)}>
                          {(member) => (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => show(event, [member.id])}
                            >
                              {member.name ??
                                services().get(member.serviceRef)?.name ??
                                member.id}{' '}
                              ·{' '}
                              {
                                props.version.view.model.nodes?.find(
                                  (node) => node.id === member.nodeRef,
                                )?.name
                              }{' '}
                              · {props.t(`role.${member.role}`)}
                            </Button>
                          )}
                        </For>
                        <Show when={hosted.length > 30}>
                          <p>
                            {props.t('moreObjects', {
                              count: hosted.length - 30,
                            })}
                          </p>
                        </Show>
                        <Show when={instance}>
                          <p>
                            {props.t(`role.${instance?.role}`)} ·{' '}
                            {
                              props.version.view.model.nodes?.find(
                                (node) => node.id === instance?.nodeRef,
                              )?.name
                            }
                            <Show when={instance?.shard}>
                              {' '}
                              · {instance?.shard}
                            </Show>
                          </p>
                          <Show when={instance?.binding}><Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              close();
                              props.onInspect(instance!);
                            }}
                          >
                            {props.t('inspectService')}
                          </Button></Show>
                        </Show>
                        <Show when={item && 'runtimeRef' in item}>
                          <code>{String(item?.runtimeRef)}</code>
                        </Show>
                        <Show when={relatedGroups.length}>
                          <section class="tessiven-memberships" data-shared={belongsToMultipleGroups}>
                            <div class="tessiven-detail-heading">
                              <Show when={belongsToMultipleGroups}>
                                <Link aria-hidden="true" />
                              </Show>
                              <strong>{props.t(belongsToMultipleGroups ? 'belongsToMultipleGroups' : 'groupMemberships')}</strong>
                              <span class="tessiven-membership-count">{relatedGroups.length}</span>
                            </div>
                            <For each={relatedGroups}>
                              {(group) => <button
                                aria-label={props.t('locateInGroup', { name: group.name })}
                                aria-current={projection().cards.get(event.object?.id ?? '')?.kind === 'node' && appearance(instance?.nodeRef ?? id, group.id) === event.object?.id ? 'location' : undefined}
                                onClick={() => locateNode(instance?.nodeRef ?? id, group.id)}
                              ><span class="tessiven-membership-mark" aria-hidden="true" /><span>{group.name}</span><ExternalLink aria-hidden="true" /></button>}
                            </For>
                          </section>
                        </Show>
                        <Show when={item && 'endpoint' in item}>
                          <code>{String(item?.endpoint)}</code>
                        </Show>
                        <Show when={item && 'from' in item}>
                          <p>
                            {String(item?.from)} → {String(item?.to)} ·{' '}
                            {props.t(`relation.${String(item?.kind)}`)}
                          </p>
                        </Show>
                        <For each={evidenceRefs.slice(0, 8)}>
                          {(ref) => {
                            const evidence =
                              props.version.view.model.evidence?.find(
                                (value) => value.id === ref,
                              );
                            return (
                              <div class="tessiven-evidence">
                                <small>
                                  {props.t(`evidence.${evidence?.source}`)}
                                </small>
                                <p>{evidence?.summary}</p>
                                <code>{evidence?.locator}</code>
                                <Show when={evidence?.observedAt}>
                                  <time>{evidence?.observedAt}</time>
                                </Show>
                              </div>
                            );
                          }}
                        </For>
                        <Show when={!evidenceRefs.length}>
                          <p class="tessiven-muted">{props.t('noEvidence')}</p>
                        </Show>
                      </section>
                    );
                  }}
                </For>
  );
  const openSummary = (event: MouseEvent | KeyboardEvent, groupRef: string, summary?: RelationSummary, menu = false) => {
    event.preventDefault();
    event.stopPropagation();
    const refs = summaryReferences(groupRef, summary);
    const origin = rowEvent(event, groupRef);
    if (menu) { show(origin, refs, true); return; }
    select(origin.object, refs);
    setPopup({ event: origin, refs, menu: false, summary: { refs: [groupRef], summaries: projection().groupRelations.get(groupRef) ?? [], key: summary?.key } });
  };
  const locateEndpoint = (ref: string) => {
    const endpoint = [...projection().relationDetails.values()].find(detail => detail.from.ref === ref || detail.to.ref === ref);
    const detail = endpoint?.from.ref === ref ? endpoint.from : endpoint?.to;
    const nodeId = detail?.nodeRefs[0] ?? ref;
    const group = projection().memberships.get(nodeId)?.[0];
    if (group) {
      setExpanded(previous => new Set([...previous, group.id]));
      setSelectedNodes(previous => ({ ...previous, [group.id]: nodeId }));
    }
    const id = appearance(nodeId, group?.id) ?? nodeId;
    close(); select({ kind: 'node', id }, [ref]); pendingLocate = id; centerSelection();
  };
  return (
    <div
      class="tessiven-canvas"
      ref={host}
      data-connection-focus={connectionFocus()?.id}
      data-connections-pending={routingPending() || undefined}
      // InfiniteCanvas owns panning, so a pointer drag over a card must never
      // fall through to the browser's native text-selection gesture.
      onSelectStart={(event) => event.preventDefault()}
      onGotPointerCapture={event => {
        if (event.target instanceof Element && event.target.matches('.floe-infinite-canvas')) {
          close(); resetConnections();
        }
      }}
    >
      <Show when={error()}>
        <div role="alert" class="tessiven-error">
          {error()}
        </div>
      </Show>
      <GraphCanvas
        layout={shownLayout()}
        highlight={null}
        viewport={viewport()}
        onViewportChange={setViewport}
        ariaLabel={props.t('canvasLabel')}
        selected={selected()}
        renderNode={renderCard}
        renderGroup={renderCard}
        onActivate={(event) => { if (event.object) show(event); else { select(null); close(); resetConnections(); } }}
        onContextMenu={(event) => show(event, undefined, true)}
        onHover={hoverConnections}
        onInteractionStart={() => { close(); resetConnections(); }}
        minimap={layout().nodes.length ? { ariaLabel: props.t('canvasOverview'), nodeStyle: minimapStyle, edges: layout().edges } : undefined}
      />
      <Show when={props.tools !== 'hidden'}><nav class="tessiven-canvas-tools" aria-label={props.t('canvasView')}>
        <button type="button" onClick={fit} aria-label={props.t('fit')} title={props.t('fit')}><Maximize aria-hidden="true" /></button>
        <div class="tessiven-canvas-zoom">
          <button type="button" onClick={() => zoom(0.8)} disabled={viewport().scale <= 0.1} aria-label={props.t('zoomOut')} title={props.t('zoomOut')}><Minus aria-hidden="true" /></button>
          <output aria-label={props.t('zoomLevel')}>{Math.round(viewport().scale * 100)}%</output>
          <button type="button" onClick={() => zoom(1.25)} disabled={viewport().scale >= 3} aria-label={props.t('zoomIn')} title={props.t('zoomIn')}><Plus aria-hidden="true" /></button>
        </div>
        <Show when={props.version.view.model.groups?.length}>
          <Dropdown triggerClass="tessiven-canvas-view" triggerAriaLabel={props.t('canvasView')}
            trigger={<><Layers aria-hidden="true" /><span>{props.t('canvasView')}</span><ChevronDown aria-hidden="true" /></>}
            value={serviceScope()}
            items={() => [
              { id: 'expand', label: props.t('expandAllGroups'), icon: () => <ChevronDown />, disabled: props.version.view.model.groups!.every(group => expanded().has(group.id)) },
              { id: 'collapse', label: props.t('collapseAllGroups'), icon: () => <ChevronUp />, disabled: !props.version.view.model.groups!.some(group => expanded().has(group.id)) },
              { id: 'scope', label: '', separator: true },
              { id: 'all', label: props.t('allNodeServices') },
              { id: 'group', label: props.t('groupNodeServices') },
            ]}
            onSelect={id => {
              close();
              if (id === 'expand' || id === 'collapse') toggleAll(id === 'expand');
              else updateServiceScope(id as NodeServiceScope);
            }} />
        </Show>
        <button
          type="button"
          onClick={(event) =>
            show(
              {
                object: null,
                position: { x: event.clientX, y: event.clientY },
                owner: event.currentTarget,
              },
              [],
              true,
            )
          }
          aria-label={props.t('canvasMenu')}
          title={props.t('canvasMenu')}
        >
          <MoreHorizontal aria-hidden="true" />
        </button>
        <Show when={layoutPending()}><span class="tessiven-layout-pending" role="status" aria-label={props.t('layoutUpdating')} /></Show>
      </nav></Show>
      <Show when={popup()} keyed>
        {(value) => (
          <TessivenObjectPopup
            event={value.event}
            onClose={close}
            onRetainConnections={retainConnections}
            onLeaveConnections={leaveConnections}
            t={props.t}
            menu={value.menu}
            relationBrowser={!!value.summary}
          >
            <Show when={!value.menu && !value.summary}>
              <div class="tessiven-detail-content">
                <Show when={!value.refs.length}>
                  <strong>{props.version.view.model.metadata.title}</strong>
                  <p>{props.version.view.model.metadata.description}</p>
                  <For
                    each={
                      ['nodes', 'services', 'resources', 'relations'] as const
                    }
                  >
                    {(kind) => (
                      <p>
                        {props.t(`collection.${kind}`)} ·{' '}
                        {props.version.view.model[kind]?.length ?? 0}
                      </p>
                    )}
                  </For>
                </Show>
                {renderDetails(value.refs, value.event)}
                <Show when={value.refs.length > 30}>
                  <p>
                    {props.t('moreObjects', { count: value.refs.length - 30 })}
                  </p>
                </Show>
              </div>
            </Show>
            <Show when={!value.menu && value.summary}>{scope => <TessivenRelationDetails
              scopeRefs={scope().refs} title={scope().title} initialKey={scope().key}
              summaries={scope().summaries}
              details={projection().relationDetails} nodes={props.version.view.model.nodes ?? []} t={props.t}
              renderDetail={id => renderDetails([id], value.event)} canAsk={canAsk} onAsk={ask} onLocate={locateEndpoint}
              onInspect={(event, id) => {
                select(rowEvent(event, id).object, [id]);
                if (props.onSelectionChange) { close(); return true; }
                return false;
              }} />}</Show>
            <Show when={!value.summary}>
            <Button
              class="tessiven-ask-flower"
              role={value.menu ? 'menuitem' : undefined}
              disabled={!canAsk(value.refs)}
              size="sm"
              variant="ghost"
              onClick={() => ask(value.refs)}
            >
              <span class="tessiven-ask-flower-mark" aria-hidden="true"><FlowerIcon /></span>
              {props.t('askFlower')}
            </Button>
            </Show>
          </TessivenObjectPopup>
        )}
      </Show>
    </div>
  );
}

function TessivenObjectPopup(props: {
  event: GraphObjectEvent;
  onClose: (restore?: boolean) => void;
  t: TessivenText;
  menu: boolean;
  relationBrowser?: boolean;
  onRetainConnections: () => void;
  onLeaveConnections: () => void;
  children: JSX.Element;
}) {
  let panel: HTMLDivElement | undefined;
  const [size, setSize] = createSignal({ width: props.menu ? 210 : 360, height: props.menu ? 62 : 430 });
  onMount(() => {
    // The shared layer owns coordinates; actual content dimensions keep its
    // clamp correct when filters, pagination, or exact details change height.
    const measure = () => { if (panel) setSize({ width: panel.offsetWidth, height: panel.offsetHeight }); };
    const observer = new ResizeObserver(measure);
    if (panel) observer.observe(panel);
    measure();
    panel?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    const focus = (event: FocusEvent) => {
      if (event.target instanceof Node && !panel?.contains(event.target))
        props.onClose();
    };
    const pointer = (event: PointerEvent) => {
      if (!event.composedPath().includes(panel!)) props.onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        props.onClose(true);
      }
      if (event.key === 'Tab' && props.menu) props.onClose(true);
      if (
        props.menu &&
        ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
      ) {
        event.preventDefault();
        panel?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
      }
    };
    document.addEventListener('focusin', focus);
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', key);
    onCleanup(() => {
      observer.disconnect();
      document.removeEventListener('focusin', focus);
      document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('keydown', key);
    });
  });
  return (
    <SurfaceFloatingLayer
      owner={props.event.owner}
      position={props.event.position}
      estimatedSize={size()}
      class="tessiven-popup-layer"
    >
      <div
        ref={panel}
        onPointerEnter={props.onRetainConnections}
        onPointerLeave={props.onLeaveConnections}
        class="tessiven-popup"
        data-relation-browser={props.relationBrowser || undefined}
        role={props.menu ? 'menu' : 'dialog'}
        aria-label={props.t(props.menu ? 'objectMenu' : 'details')}
        style={{ width: props.menu ? '210px' : '360px' }}
      >
        <Show when={!props.menu}>
          <header>
            <strong>{props.t('details')}</strong>
            <button
              onClick={() => props.onClose(true)}
              aria-label={props.t('close')}
            >
              ×
            </button>
          </header>
        </Show>
        {props.children}
      </div>
    </SurfaceFloatingLayer>
  );
}
