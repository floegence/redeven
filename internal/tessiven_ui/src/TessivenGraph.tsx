import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
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
  type GraphNodeRenderContext,
  type GraphObjectEvent,
  type GraphObjectRef,
} from '@floegence/floe-webapp-core/graph';
import { Button, SurfaceFloatingLayer } from '@floegence/floe-webapp-core/ui';
import { ArrowRight, Link, ExternalLink } from '@floegence/floe-webapp-core/icons';
import '@floegence/floe-webapp-core/graph.css';
import { projectCanvas, projectPositions } from './projection';
import { TessivenIcon } from './TessivenIcon';
import { FlowerIcon } from '../../flower_ui/src/icons/FlowerIcon';
import type {
  Instance,
  Observation,
  Selection,
  TessivenText,
  Version,
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
};
export function TessivenGraph(props: {
  version: Version;
  historical: boolean;
  t: TessivenText;
  onAsk: (selection: Selection) => void;
  onInspect: (instance: Instance) => void;
  locate?: string;
  visible?: boolean;
  browseState?: GraphBrowseState;
  onBrowseState?: (state: GraphBrowseState) => void;
}) {
  const [expanded, setExpanded] = createSignal(
    new Set(
      props.browseState?.expanded ??
        props.version.document.presentation?.initiallyExpanded ??
        [],
    ),
  );
  const [selectedNodes, setSelectedNodes] = createSignal<
    Record<string, string>
  >(props.browseState?.selectedNodes ?? {});
  const [viewport, setViewport] = createSignal(
    props.browseState?.viewport ?? { x: 40, y: 40, scale: 1 },
  );
  const [layout, setLayout] = createSignal<GraphLayout>({
    nodes: [],
    edges: [],
    bounds: { x: 0, y: 0, width: 1, height: 1 },
  });
  const [selected, setSelected] = createSignal<GraphObjectRef | null>(null);
  const [hovered, setHovered] = createSignal<GraphObjectRef | null>(null);
  const [popup, setPopup] = createSignal<{
    event: GraphObjectEvent;
    refs: string[];
    menu: boolean;
  } | null>(null);
  const [error, setError] = createSignal('');
  const engine = createGraphLayoutEngine();
  let generation = 0,
    initialized = !!props.browseState;
  let host: HTMLDivElement | undefined;
  onCleanup(() => engine.dispose());
  onCleanup(() => {
    // Empty canvases have no meaningful viewport to restore after Flower maps them.
    if (!layout().nodes.length) return;
    props.onBrowseState?.({
      expanded: [...expanded()],
      selectedNodes: selectedNodes(),
      viewport: viewport(),
    });
  });
  const projection = createMemo(() =>
    projectCanvas(props.version.document, expanded(), selectedNodes()),
  );
  // Presentation positions are hints attached to the saved document. Only
  // objects that are currently rendered are sent to Floe; collapsed members
  // keep their saved pins in the document and are applied when expanded.
  const positions = createMemo(() => projectPositions(props.version.document, projection()));
  const linkedNode = createMemo(() => {
    const object = hovered() ?? selected();
    const card = object?.kind === 'node' ? projection().cards.get(object.id) : undefined;
    return card?.kind === 'node' ? card.node.id : undefined;
  });
  const canonicalRef = (id: string) => {
    const card = projection().cards.get(id);
    return card?.kind === 'node' ? card.node.id : id;
  };
  const appearance = (nodeId: string, groupId?: string) =>
    projection().appearances.get(nodeId)?.find(id => {
      const card = projection().cards.get(id);
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
        ].flatMap((kind) =>
          (
            (
              props.version.document as unknown as Record<
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
        (props.version.document.services ?? []).map((service) => [
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
    const projected = projection();
    const expandedGroupRelationRows = [...projected.internalRelations.entries()]
      .filter(([id]) => {
        const card = projected.cards.get(id);
        return card?.kind === 'group' && card.expanded;
      })
      .map(([, relations]) => relations.length);
    const groupRelationPadding = Math.max(0, ...expandedGroupRelationRows) * 30;
    const input = {
      ...projected.graph,
      edges: projected.graph.edges.map((edge) => {
        const relations = projected.relations.get(edge.id)!;
        return {
          ...edge,
          label:
            relations.length > 1
              ? String(relations.length)
              : (relations[0].protocol ??
                props.t(`relation.${relations[0].kind}`)),
        };
      }),
    };
    const id = ++generation;
    const anchor = untrack(() =>
      layout().nodes.find((node) => node.id === selected()?.id),
    );
    void engine
      .layout(input, {
        direction: 'RIGHT',
        aspectRatio: 1.6,
        spacing: 32,
        groupPadding: { top: 108 + groupRelationPadding, right: 20, bottom: 20, left: 20 },
        positions: positions(),
        positionMode: 'preferred',
        anchor: anchor
          ? { nodeId: anchor.id, position: { x: anchor.x, y: anchor.y } }
          : undefined,
      })
      .then((next) => {
        if (id !== generation) return;
        setLayout(next);
        setError('');
        if (!initialized) {
          initialized = true;
          requestAnimationFrame(fit);
        }
        centerSelection();
      })
      .catch((cause: unknown) => {
        if (id === generation) setError(String(cause));
      });
  });
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
    const document = props.version.document;
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
      setSelected({ kind: 'node', id: viewID });
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
    if (restore) {
      const object = selected();
      const target = owner instanceof HTMLElement && owner.isConnected && owner.matches('button, a, input, select, textarea, [tabindex]')
        ? owner : object?.kind === 'node' ? host?.querySelector<HTMLElement>(`[data-graph-object="${object.id}"]`) : undefined;
      target?.focus({ preventScroll: true });
    }
  }
  function show(event: GraphObjectEvent, refs?: string[], menu = false) {
    setSelected(event.object);
    setPopup({
      event,
      refs:
        refs ??
        (event.object?.kind === 'edge'
          ? (projection()
              .relations.get(event.object.id)
              ?.map((value) => value.id) ?? [])
          : event.object
            ? [canonicalRef(event.object.id)]
            : []),
      menu,
    });
  }
  function ask(refs: string[]) {
    if (refs.length > 100) {
      const object = popup()?.event.object;
      const edge =
        object?.kind === 'edge'
          ? projection().graph.edges.find((edge) => edge.id === object.id)
          : undefined;
      refs = edge ? [canonicalRef(edge.source), canonicalRef(edge.target)] : object ? [canonicalRef(object.id)] : [];
    }
    close();
    props.onAsk({
      canvas_id: props.version.canvas_id,
      version_id: props.version.number,
      object_refs: refs,
    });
  }
  function toggle(id: string) {
    setSelected({ kind: 'node', id });
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    close();
  }
  function locateNode(nodeId: string, groupId: string) {
    setExpanded(previous => new Set([...previous, groupId]));
    setSelectedNodes(previous => ({ ...previous, [groupId]: nodeId }));
    const id = appearance(nodeId, groupId)!;
    setSelected({ kind: 'node', id });
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
  const serviceRows = (instances: Instance[], limit = Infinity, ownerId?: string): JSX.Element => {
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
                <TessivenIcon kind={service()?.kind ?? 'service'} />
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
  const internalRelationRows = (ownerId: string): JSX.Element => {
    const relations = projection().internalRelations.get(ownerId) ?? [];
    return (
      <Show when={relations.length}>
        <div class="tessiven-local-relations">
          <For each={relations}>
            {(item) => {
              const kind = () => item.relation.protocol ?? props.t(`relation.${item.relation.kind}`);
              return (
                <button
                  class="tessiven-local-relation"
                  aria-label={`${item.fromLabel} ${kind()} ${item.toLabel}`}
                  onKeyDown={(event) => keyboardMenu(event, item.relation.id, [item.relation.id])}
                  onClick={(event) => {
                    event.stopPropagation();
                    show(rowEvent(event, item.relation.id), [item.relation.id]);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    show(rowEvent(event, item.relation.id), [item.relation.id], true);
                  }}
                >
                  <span>{item.fromLabel}</span>
                  <ArrowRight aria-hidden="true" />
                  <span>{item.toLabel}</span>
                  <small>{kind()}</small>
                </button>
              );
            }}
          </For>
        </div>
      </Show>
    );
  };
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
          data-tone={
            (props.version.document.groups ?? []).findIndex(
              (value) => value.id === node.id,
            ) % 4
          }
          data-expanded={card.expanded}
        >
          <header>
            <span class="tessiven-group-mark" />
            <strong>{card.group.name}</strong>
            <span class="tessiven-count">{card.nodes.length}</span>
            <button
              onClick={() => toggle(node.id)}
              aria-label={props.t(card.expanded ? 'collapse' : 'expand')}
            >
              {card.expanded ? '−' : '+'}
            </button>
            <button
              onClick={context.openMenu}
              aria-label={props.t('objectMenu')}
            >
              ⋯
            </button>
          </header>
          <div class="tessiven-group-caption">
            <span>{props.t('logicalGroup')}</span>
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
            <div class="tessiven-group-services">
              {serviceRows(card.instances, 8)}
            </div>
            <button class="tessiven-more" onClick={() => toggle(node.id)}>
              {props.t('expandNodes')}
            </button>
          </Show>
          {internalRelationRows(node.id)}
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
                <Link class="size-3.5" />{projection().memberships.get(card.node.id)!.length}
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
                show(rowEvent(event, node.id), [card.node.id]);
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
            {serviceRows(card.instances, Infinity, node.id)}
            {internalRelationRows(node.id)}
          </div>
        </section>
      );
    if (card.kind === 'resource')
      return (
        <section
          class="tessiven-resource"
          data-resource={
            ['domain', 'cdn', 'load_balancer'].includes(card.resource.kind)
              ? 'network'
              : 'storage'
          }
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
      <section class="tessiven-unplaced">
        <TessivenIcon kind={card.service.kind} />
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
  return (
    <div
      class="tessiven-canvas"
      ref={host}
      // InfiniteCanvas owns panning, so a pointer drag over a card must never
      // fall through to the browser's native text-selection gesture.
      onSelectStart={(event) => event.preventDefault()}
    >
      <Show when={error()}>
        <div role="alert" class="tessiven-error">
          {error()}
        </div>
      </Show>
      <GraphCanvas
        layout={layout()}
        viewport={viewport()}
        onViewportChange={setViewport}
        ariaLabel={props.t('canvasLabel')}
        selected={selected()}
        renderNode={renderCard}
        renderGroup={renderCard}
        onActivate={(event) => show(event)}
        onContextMenu={(event) => show(event, undefined, true)}
        onHover={setHovered}
        onInteractionStart={() => close()}
      />
      <div class="tessiven-canvas-tools" title={props.t('canvasHint')}>
        <button onClick={fit}>{props.t('fit')}</button>
        <span>{Math.round(viewport().scale * 100)}%</span>
        <button
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
        >
          ⋯
        </button>
      </div>
      <Show when={popup()} keyed>
        {(value) => (
          <TessivenObjectPopup
            event={value.event}
            onClose={close}
            t={props.t}
            menu={value.menu}
          >
            <Show when={!value.menu}>
              <div class="tessiven-detail-content">
                <Show when={!value.refs.length}>
                  <strong>{props.version.document.metadata.title}</strong>
                  <p>{props.version.document.metadata.description}</p>
                  <For
                    each={
                      ['nodes', 'services', 'resources', 'relations'] as const
                    }
                  >
                    {(kind) => (
                      <p>
                        {props.t(`collection.${kind}`)} ·{' '}
                        {props.version.document[kind]?.length ?? 0}
                      </p>
                    )}
                  </For>
                </Show>
                <For each={value.refs.slice(0, 30)}>
                  {(id) => {
                    const item = allObjects().get(id) as
                      | (Record<string, unknown> & { id: string })
                      | undefined;
                    const instance = props.version.document.instances?.find(
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
                      props.version.document.relations ?? []
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
                      props.version.document.instances?.filter(
                        (member) =>
                          member.serviceRef === id || member.nodeRef === id,
                      ) ?? [];
                    const relatedGroups = instance ? projection().instanceMemberships.get(instance.id) ?? [] : projection().memberships.get(id) ?? [];
                    return (
                      <section class="tessiven-detail-object">
                        <strong>{title}</strong>
                        <code>{id}</code>
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
                              onClick={() => show(value.event, [member.id])}
                            >
                              {member.name ??
                                services().get(member.serviceRef)?.name ??
                                member.id}{' '}
                              ·{' '}
                              {
                                props.version.document.nodes?.find(
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
                              props.version.document.nodes?.find(
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
                          <section class="tessiven-memberships">
                            <div class="tessiven-detail-heading"><span>{props.t('groupMemberships')}</span><span>{relatedGroups.length}</span></div>
                            <For each={relatedGroups}>
                              {(group) => <button
                                aria-label={props.t('locateInGroup', { name: group.name })}
                                aria-current={projection().cards.get(value.event.object?.id ?? '')?.kind === 'node' && appearance(instance?.nodeRef ?? id, group.id) === value.event.object?.id ? 'location' : undefined}
                                onClick={() => locateNode(instance?.nodeRef ?? id, group.id)}
                              ><span>{group.name}</span><ExternalLink class="size-3.5" /></button>}
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
                              props.version.document.evidence?.find(
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
                <Show when={value.refs.length > 30}>
                  <p>
                    {props.t('moreObjects', { count: value.refs.length - 30 })}
                  </p>
                </Show>
              </div>
            </Show>
            <Button
              class="tessiven-ask-flower"
              role={value.menu ? 'menuitem' : undefined}
              size="sm"
              variant="ghost"
              onClick={() => ask(value.refs)}
            >
              <span class="tessiven-ask-flower-mark" aria-hidden="true"><FlowerIcon /></span>
              {props.t('askFlower')}
            </Button>
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
  children: JSX.Element;
}) {
  let panel: HTMLDivElement | undefined;
  onMount(() => {
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
      document.removeEventListener('focusin', focus);
      document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('keydown', key);
    });
  });
  return (
    <SurfaceFloatingLayer
      owner={props.event.owner}
      position={props.event.position}
      estimatedSize={{
        width: props.menu ? 210 : 360,
        height: props.menu ? 62 : 430,
      }}
      class="tessiven-popup-layer"
    >
      <div
        ref={panel}
        class="tessiven-popup"
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
