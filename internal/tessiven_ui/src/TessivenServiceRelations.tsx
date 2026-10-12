import { For, Show, createEffect, createMemo, createResource, createSignal, createUniqueId, onCleanup, type JSX } from 'solid-js';
import { graphSectionPath, type GraphLayoutEngine, type GraphLayoutNode } from '@floegence/floe-webapp-core/graph';
import { ArrowRight, Link, Refresh } from '@floegence/floe-webapp-core/icons';
import type { InternalRelation } from './projection';
import { relationPreviewLimit, type RelationSummary } from './relations';
import type { TessivenText } from './types';

export type ServiceRelationEndpoint = 'source' | 'target' | 'both';

/** Local service rows are fixed geometry; Floe still owns connector routing. */
export function TessivenServiceRelations(props: {
  relations: readonly InternalRelation[];
  summaries?: readonly RelationSummary[];
  onSummaryActivate?: (event: MouseEvent, summary: RelationSummary) => void;
  onSummaryContextMenu?: (event: MouseEvent, summary: RelationSummary) => void;
  onSummaryKeyDown?: (event: KeyboardEvent, summary: RelationSummary) => void;
  onShowAll?: (event: MouseEvent) => void;
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
  const items = createMemo(() => props.summaries
    ? props.summaries.slice(0, relationPreviewLimit).map(summary => ({
      key: summary.key, fromLabel: summary.from.label, toLabel: summary.to.label,
      fromServiceRef: summary.from.serviceRef, toServiceRef: summary.to.serviceRef,
      kind: summary.kind, protocol: summary.protocol, canRoute: summary.locality === 'local', summary, relation: undefined,
    }))
    : props.relations.map(item => ({ ...item, key: item.relation.id, kind: item.relation.kind,
      protocol: item.relation.protocol, canRoute: true, summary: undefined })));
  const active = createMemo(() => items().find(item => item.key === (hovered() ?? focused())));
  createEffect(() => {
    // Row geometry is needed only while a local relationship is inspected.
    // Measuring every mounted inventory forces layout during large graph paint.
    if (!active()) { setRows([]); return; }
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
  const activeServices = createMemo(() => {
    const item = active();
    const visible = new Set(rows().map(row => row.id));
    if (!item?.fromServiceRef || !item.toServiceRef
      || !visible.has(item.fromServiceRef) || !visible.has(item.toServiceRef)) return undefined;
    return { item, nodes: rows() };
  });
  const routeInput = createMemo(() => active()?.canRoute ? activeServices() : undefined);
  const [preview] = createResource(routeInput, async ({ item, nodes }) => {
    // Instances of one service share a row; their preview is a loop glyph.
    if (item.fromServiceRef === item.toServiceRef) return undefined;
    try {
      const layout = await props.engine.layout({ nodes, edges: [{
        id: item.key, label: '', source: item.fromServiceRef!, target: item.toServiceRef!,
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
    if (!activeServices()) return undefined;
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
      <Show when={routeInput() && !preview.loading && preview()?.id === active()?.key && preview()}>
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
    <Show when={items().length}>
      <section class="tessiven-local-relations" aria-label={props.t('serviceRelations')}>
        <h3><Link aria-hidden="true" /><span>{props.t('serviceRelations')}</span></h3>
        <div class="tessiven-local-relation-list">
          <For each={items()}>{item => {
            const kind = () => item.protocol ?? props.t(`relation.${item.kind}`);
            return <button type="button" class="tessiven-local-relation"
              data-relation-id={item.relation?.id} data-relation-summary={item.summary?.key} data-relation-count={item.summary?.relationRefs.length}
              data-active={active()?.key === item.key}
              aria-label={`${item.fromLabel} ${kind()} ${item.toLabel}${item.summary ? ` · ${props.t('relationCount', { count: item.summary.relationRefs.length })}` : ''}`}
              onPointerEnter={event => { if (event.pointerType !== 'touch') { setFocused(undefined); setHovered(item.key); } }}
              onPointerLeave={clear}
              onFocus={event => { if (event.currentTarget.matches(':focus-visible')) setFocused(item.key); }}
              onBlur={() => setFocused(undefined)}
              onKeyDown={event => item.summary ? props.onSummaryKeyDown?.(event, item.summary) : props.onKeyDown(event, item.key)}
              onClick={event => { clear(); if (item.summary) props.onSummaryActivate?.(event, item.summary); else props.onActivate(event, item.key); }}
              onContextMenu={event => { clear(); if (item.summary) props.onSummaryContextMenu?.(event, item.summary); else props.onContextMenu(event, item.key); }}>
              <span>{item.fromLabel}</span><ArrowRight aria-hidden="true" /><span>{item.toLabel}</span>
              <small classList={{ 'tessiven-relation-summary-meta': !!item.summary }}><span>{kind()}</span>
                <Show when={item.summary}>{summary => <span><span>{props.t(`relationLocality.${summary().locality}`)}</span><span class="tessiven-relation-summary-count"> · {summary().relationRefs.length}</span></span>}</Show>
              </small>
            </button>;
          }}</For>
          <Show when={(props.summaries?.length ?? 0) > relationPreviewLimit}>
            <button type="button" class="tessiven-relation-more" onClick={props.onShowAll}>
              {props.t('allRelationPatterns', { count: props.summaries!.length })}
            </button>
          </Show>
        </div>
      </section>
    </Show>
  </>;
}
