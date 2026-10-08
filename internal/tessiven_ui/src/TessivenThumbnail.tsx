import { For, Show, createMemo, createResource, createUniqueId } from 'solid-js';
import {
  graphSectionPath,
  type GraphLayoutEngine,
  type GraphLayoutNode,
} from '@floegence/floe-webapp-core/graph';
import { projectCanvas } from './projection';
import { TessivenIcon } from './TessivenIcon';
import type { CanvasDocument, TessivenText } from './types';

export function TessivenThumbnail(props: {
  document: CanvasDocument;
  t: TessivenText;
  engine: GraphLayoutEngine;
}) {
  const arrowID = createUniqueId();
  const projection = createMemo(() =>
    projectCanvas(
      props.document,
      new Set(props.document.presentation?.initiallyExpanded ?? []),
      {},
    ),
  );
  const [layout] = createResource(projection, async (projected) => {
    const visible = new Set(projected.graph.nodes.map(node => node.id));
    try {
      return await props.engine.layout(projected.graph, {
        direction: 'RIGHT', spacing: 64,
        groupPadding: { top: 108, right: 20, bottom: 20, left: 20 },
        positions: (props.document.presentation?.positions ?? [])
          .filter(position => visible.has(position.objectRef))
          .map(position => ({ nodeId: position.objectRef, x: position.x, y: position.y })),
      });
    } catch {
      return undefined;
    }
  });
  const services = createMemo(
    () => new Map((props.document.services ?? []).map(service => [service.id, service])),
  );
  const renderObject = (node: GraphLayoutNode) => {
    const card = projection().cards.get(node.id)!;
    if (card.kind === 'node' || card.kind === 'group') {
      const hosted = [...new Set(card.instances.map(instance => instance.serviceRef))]
        .flatMap(id => services().has(id) ? [services().get(id)!] : []);
      return (
        <div
          class="tessiven-thumbnail-host"
          classList={{ 'tessiven-thumbnail-group': card.kind === 'group' }}
        >
          <div class="tessiven-thumbnail-header">
            <TessivenIcon kind={card.kind === 'group' ? 'tessiven' : 'node'} />
            <strong>{node.label}</strong>
          </div>
          <Show when={card.kind === 'group'}>
            <small>{props.t('nodeCount', { count: card.kind === 'group' ? card.nodes.length : 0 })}</small>
          </Show>
          <Show when={card.kind !== 'group' || !card.expanded}>
            <For each={hosted.slice(0, 4)}>
              {(service) => (
                <div class="tessiven-thumbnail-service">
                  <TessivenIcon kind={service.kind} />
                  <span>{service.name}</span>
                </div>
              )}
            </For>
            <Show when={hosted.length > 4}>
              <small>{props.t('moreServices', { count: hosted.length - 4 })}</small>
            </Show>
          </Show>
        </div>
      );
    }
    const kind = card.kind === 'resource' ? card.resource.kind : card.service.kind;
    return (
      <div
        class="tessiven-thumbnail-resource"
        data-kind={['domain', 'cdn', 'gateway', 'load_balancer'].includes(kind) ? 'network' : 'storage'}
      >
        <TessivenIcon kind={kind} />
        <strong>{node.label}</strong>
        <small>{props.t(card.kind === 'resource' ? `kind.${kind}` : 'unplacedService')}</small>
      </div>
    );
  };
  return (
    <Show
      when={layout()}
      fallback={
        <div class="tessiven-preview-placeholder">
          <TessivenIcon kind="tessiven" />
          <span>{props.t(layout.loading ? 'previewLoading' : 'previewUnavailable')}</span>
        </div>
      }
    >
      {(value) => {
        const bounds = () => value().bounds;
        return (
          <svg
            class="tessiven-thumbnail"
            viewBox={`${bounds().x - 32} ${bounds().y - 32} ${bounds().width + 64} ${bounds().height + 64}`}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
          >
            <defs>
              <marker
                id={arrowID}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0 1L9 5L0 9" fill="none" stroke="currentColor" stroke-width="1.5" />
              </marker>
            </defs>
            <For each={value().edges}>
              {(edge) => (
                <g data-preview-edge={edge.id}>
                  <For each={edge.sections}>
                    {(section) => (
                      <path
                        class="tessiven-thumbnail-edge"
                        d={graphSectionPath(section)}
                        marker-end={`url(#${arrowID})`}
                      />
                    )}
                  </For>
                </g>
              )}
            </For>
            <For each={value().nodes}>
              {(node) => (
                <foreignObject
                  data-preview-object={node.id}
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                >
                  {renderObject(node)}
                </foreignObject>
              )}
            </For>
          </svg>
        );
      }}
    </Show>
  );
}
