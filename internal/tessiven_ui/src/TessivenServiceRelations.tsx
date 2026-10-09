import { For, Show, createMemo, createResource, createSignal, createUniqueId, onCleanup, onMount, type JSX } from 'solid-js';
import { graphSectionPath, type GraphLayoutEngine, type GraphLayoutNode } from '@floegence/floe-webapp-core/graph';
import { ArrowRight, Link, Refresh } from '@floegence/floe-webapp-core/icons';
import type { InternalRelation } from './projection';
import type { TessivenText } from './types';

export type ServiceRelationEndpoint = 'source' | 'target' | 'both';

/** Local service rows are fixed geometry; Floe still owns connector routing. */
export function TessivenServiceRelations(props: {
  relations: InternalRelation[];
  engine: GraphLayoutEngine;
  t: TessivenText;
  group?: boolean;
  renderServices: (endpoint: (id: string) => ServiceRelationEndpoint | undefined) => JSX.Element;
  onActivate: (event: MouseEvent, id: string) => void;
  onContextMenu: (event: MouseEvent, id: string) => void;
  onKeyDown: (event: KeyboardEvent, id: string) => void;
  onError: (cause: unknown) => void;
}) {
  let inventory!: HTMLDivElement;
  const marker = createUniqueId();
  const [hovered, setHovered] = createSignal<string>();
  const [focused, setFocused] = createSignal<string>();
  const [rows, setRows] = createSignal<GraphLayoutNode[]>([]);
  const active = createMemo(() => props.relations.find(item => item.relation.id === (hovered() ?? focused())));
  onMount(() => {
    // Retained hidden canvases have zero-size rows, not routable geometry.
    const measure = () => setRows([...inventory.querySelectorAll<HTMLElement>('[data-service-id]')].map(row => ({
      id: row.dataset.serviceId!, label: '', x: row.offsetLeft, y: row.offsetTop,
      width: row.offsetWidth, height: row.offsetHeight,
      ports: [{ id: `service-port:${row.dataset.serviceId}`, side: 'WEST' as const }],
    })).filter(row => row.width > 0 && row.height > 0));
    const observer = new ResizeObserver(measure);
    observer.observe(inventory);
    measure();
    onCleanup(() => observer.disconnect());
  });
  const routeInput = createMemo(() => {
    const item = active();
    const visible = new Set(rows().map(row => row.id));
    if (!item?.fromServiceRef || !item.toServiceRef
      || !visible.has(item.fromServiceRef) || !visible.has(item.toServiceRef)) return undefined;
    return { item, nodes: rows() };
  });
  const [preview] = createResource(routeInput, async ({ item, nodes }) => {
    // Instances of one service share a row; their preview is a loop glyph.
    if (item.fromServiceRef === item.toServiceRef) return undefined;
    try {
      const layout = await props.engine.layout({ nodes, edges: [{
        id: item.relation.id, label: '', source: item.fromServiceRef!, target: item.toServiceRef!,
        sourcePort: `service-port:${item.fromServiceRef}`, targetPort: `service-port:${item.toServiceRef}`,
      }] }, { positions: nodes.map(({ id, x, y }) => ({ nodeId: id, x, y })), positionMode: 'fixed', edgeClearance: 20 });
      return layout.edges[0];
    } catch (cause) {
      props.onError(cause);
      return undefined;
    }
  });
  const singleEndpoint = createMemo(() => {
    const input = routeInput();
    return input?.item.fromServiceRef === input?.item.toServiceRef
      ? input?.nodes.find(row => row.id === input.item.fromServiceRef) : undefined;
  });
  const endpoint = (id: string): ServiceRelationEndpoint | undefined => {
    if (!routeInput()) return undefined;
    const item = active()!;
    return item.fromServiceRef === id ? item.toServiceRef === id ? 'both' : 'source'
      : item.toServiceRef === id ? 'target' : undefined;
  };
  const clear = () => { setHovered(undefined); setFocused(undefined); };
  return <>
    <div ref={inventory} class="tessiven-service-inventory" classList={{ 'tessiven-group-services': props.group }}>
      {props.renderServices(endpoint)}
      <Show when={singleEndpoint()}>{row => <Refresh class="tessiven-service-self-link"
        style={{ top: `${row().y + row().height / 2 - 8}px` }} aria-hidden="true" />}</Show>
      <Show when={routeInput() && !preview.loading && preview()?.id === active()?.relation.id && preview()}>
        {edge => <svg class="tessiven-service-link-preview" aria-hidden="true">
          <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M1 1L9 5L1 9" fill="none" stroke="currentColor" stroke-width="1.6" />
          </marker></defs>
          <For each={edge().sections}>{section => <>
            <path data-relation-id={edge().id} d={graphSectionPath(section)} marker-end={`url(#${marker})`} />
            <circle cx={section[0].x} cy={section[0].y} r="2.4" />
          </>}</For>
        </svg>}
      </Show>
    </div>
    <Show when={props.relations.length}>
      <section class="tessiven-local-relations" aria-label={props.t('serviceRelations')}>
        <h3><Link aria-hidden="true" /><span>{props.t('serviceRelations')}</span></h3>
        <div class="tessiven-local-relation-list">
          <For each={props.relations}>{item => {
            const kind = () => item.relation.protocol ?? props.t(`relation.${item.relation.kind}`);
            return <button type="button" class="tessiven-local-relation"
              data-relation-id={item.relation.id} data-active={active()?.relation.id === item.relation.id}
              aria-label={`${item.fromLabel} ${kind()} ${item.toLabel}`}
              onPointerEnter={event => { if (event.pointerType !== 'touch') { setFocused(undefined); setHovered(item.relation.id); } }}
              onPointerLeave={clear}
              onFocus={event => { if (event.currentTarget.matches(':focus-visible')) setFocused(item.relation.id); }}
              onBlur={() => setFocused(undefined)}
              onKeyDown={event => props.onKeyDown(event, item.relation.id)}
              onClick={event => { clear(); props.onActivate(event, item.relation.id); }}
              onContextMenu={event => { clear(); props.onContextMenu(event, item.relation.id); }}>
              <span>{item.fromLabel}</span><ArrowRight aria-hidden="true" /><span>{item.toLabel}</span><small>{kind()}</small>
            </button>;
          }}</For>
        </div>
      </section>
    </Show>
  </>;
}
