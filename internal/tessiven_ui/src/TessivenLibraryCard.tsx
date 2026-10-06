import { For, Show, createResource } from 'solid-js';
import { TessivenIcon } from './TessivenIcon';
import type { Canvas, TessivenText, TessivenTransport, Version } from './types';

export function TessivenLibraryCard(props: {
  canvas: Canvas;
  transport: TessivenTransport;
  t: TessivenText;
  locale?: string;
  onOpen: () => void;
}) {
  const [preview] = createResource(
    () => `${props.canvas.id}/versions/${props.canvas.latest_version}`,
    async (path) => {
      try {
        return await props.transport.request<Version>(
          'GET',
          `/canvases/${path}`,
        );
      } catch {
        return undefined;
      }
    },
  );
  const nodes = () => preview()?.document.nodes ?? [];
  const services = () => {
    const doc = preview()?.document;
    const node = nodes()[0];
    if (!node) return doc?.services ?? [];
    const hosted = new Set(
      (doc?.instances ?? [])
        .filter((instance) => instance.nodeRef === node.id)
        .map((instance) => instance.serviceRef),
    );
    return (doc?.services ?? []).filter((service) => hosted.has(service.id));
  };
  const resources = () => preview()?.document.resources ?? [];
  return (
    <article class="tessiven-library-card">
      <button onClick={props.onOpen} aria-label={props.canvas.title}>
        <div class="tessiven-card-preview" aria-hidden="true">
          <Show when={preview()?.source === 'example'}>
            <span class="tessiven-preview-badge">{props.t('example')}</span>
          </Show>
          <Show
            when={nodes().length || services().length || resources().length}
            fallback={
              <TessivenIcon kind="tessiven" class="tessiven-preview-empty" />
            }
          >
            <Show when={nodes().length || services().length}>
              <div class="tessiven-preview-host">
                <Show when={nodes().length}>
                  <div class="tessiven-preview-host-header">
                    <TessivenIcon kind="node" />
                    <span>{nodes()[0]?.name}</span>
                  </div>
                </Show>
                <For each={services().slice(0, 3)}>
                  {(service) => (
                    <div class="tessiven-preview-service">
                      <TessivenIcon kind={service.kind} />
                      <span>{service.name}</span>
                    </div>
                  )}
                </For>
                <Show when={!services().length}>
                  <div class="tessiven-preview-service">
                    <span>
                      {props.t('nodeCount', { count: nodes().length })}
                    </span>
                  </div>
                </Show>
              </div>
            </Show>
            <Show when={resources().length}>
              <div class="tessiven-preview-resources">
                <For each={resources().slice(0, 2)}>
                  {(resource) => (
                    <div>
                      <TessivenIcon kind={resource.kind} />
                      <span>{resource.name}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>
        <div class="tessiven-card-information">
          <h3>{props.canvas.title}</h3>
          <div class="tessiven-card-meta">
            <span>
              {props.t('version', { version: props.canvas.latest_version })}
            </span>
            <time>
              {new Date(props.canvas.updated_at).toLocaleDateString(
                props.locale,
                { month: 'short', day: 'numeric' },
              )}
            </time>
          </div>
        </div>
      </button>
    </article>
  );
}
