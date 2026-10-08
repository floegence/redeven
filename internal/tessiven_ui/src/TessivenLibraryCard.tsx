import { For, Show, createResource, createUniqueId, onCleanup } from 'solid-js';
import { ArrowRight } from '@floegence/floe-webapp-core/icons';
import {
  createGraphLayoutEngine,
  type GraphLayoutEngine,
} from '@floegence/floe-webapp-core/graph';
import { TessivenIcon } from './TessivenIcon';
import { TessivenThumbnail } from './TessivenThumbnail';
import type { Canvas, TessivenText, TessivenTransport, Version } from './types';

export function TessivenLibraryCard(props: {
  canvas: Canvas;
  transport: TessivenTransport;
  t: TessivenText;
  locale?: string;
  layoutEngine?: GraphLayoutEngine;
  onOpen: () => void;
}) {
  const descriptionID = createUniqueId();
  const layoutEngine = props.layoutEngine ?? createGraphLayoutEngine();
  if (!props.layoutEngine) onCleanup(() => layoutEngine.dispose());
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
  const hasObjects = () =>
    ['nodes', 'services', 'resources'].some(
      (kind) =>
        (preview()?.document[kind as 'nodes' | 'services' | 'resources']?.length ??
          0) > 0,
    );
  const description = () =>
    props.canvas.description || preview()?.document.metadata.description;
  return (
    <article class="tessiven-library-card">
      <button
        type="button"
        onClick={props.onOpen}
        aria-label={props.canvas.title}
        aria-describedby={descriptionID}
      >
        <div class="tessiven-card-preview" aria-hidden="true">
          <Show
            when={preview() && hasObjects()}
            fallback={
              <div
                class="tessiven-preview-placeholder"
                classList={{ 'tessiven-preview-placeholder--loading': preview.loading }}
              >
                <TessivenIcon kind="tessiven" />
                <span>
                  {props.t(
                    preview.loading
                      ? 'previewLoading'
                      : preview()
                        ? 'previewEmpty'
                        : 'previewUnavailable',
                  )}
                </span>
              </div>
            }
          >
            <TessivenThumbnail document={preview()!.document} t={props.t} engine={layoutEngine} />
          </Show>
        </div>
        <Show when={preview()?.source === 'example'}>
          <span class="tessiven-preview-badge">{props.t('example')}</span>
        </Show>
        <div class="tessiven-card-information">
          <div class="tessiven-card-title">
            <h3 title={props.canvas.title}>{props.canvas.title}</h3>
            <ArrowRight aria-hidden="true" />
          </div>
          <div class="tessiven-card-meta">
            <span>
              {props.t('version', { version: props.canvas.latest_version })}
            </span>
            <time dateTime={new Date(props.canvas.updated_at).toISOString()}>
              {new Date(props.canvas.updated_at).toLocaleDateString(
                props.locale,
                { month: 'short', day: 'numeric' },
              )}
            </time>
          </div>
          <div class="tessiven-card-reveal" id={descriptionID}>
            <div>
              <Show when={description()}>
                <p>{description()}</p>
              </Show>
              <Show when={preview()}>
                <dl class="tessiven-card-counts">
                  <For each={['nodes', 'services', 'relations'] as const}>
                    {(kind) => (
                      <div>
                        <dt>{props.t(`collection.${kind}`)}</dt>
                        <dd>{preview()?.document[kind]?.length ?? 0}</dd>
                      </div>
                    )}
                  </For>
                </dl>
              </Show>
            </div>
          </div>
        </div>
      </button>
    </article>
  );
}
