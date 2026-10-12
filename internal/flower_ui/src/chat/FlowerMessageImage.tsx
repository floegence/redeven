import { FileItemIcon } from '@floegence/floe-webapp-core/file-browser';
import type { Component } from 'solid-js';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';

export type FlowerMessageImageProps = Readonly<{
  src: string;
  alt: string;
  name: string;
  unavailableLabel: string;
  load: (url: string, signal: AbortSignal) => Promise<Blob>;
  onOpen: () => void;
}>;

export const FlowerMessageImage: Component<FlowerMessageImageProps> = (props) => {
  const [objectURL, setObjectURL] = createSignal('');
  const [failed, setFailed] = createSignal(false);
  let loadingElement: HTMLDivElement | undefined;

  createEffect(() => {
    const src = props.src;
    setObjectURL('');
    setFailed(false);
    if (!src) return;

    const controller = new AbortController();
    let activeObjectURL = '';
    let observer: IntersectionObserver | undefined;
    let started = false;
    const load = () => {
      if (started) return;
      started = true;
      observer?.disconnect();
      void props.load(src, controller.signal).then((blob) => {
        if (controller.signal.aborted) return;
        if (!blob.type.startsWith('image/')) throw new Error('Invalid attachment image.');
        activeObjectURL = URL.createObjectURL(blob);
        setObjectURL(activeObjectURL);
      }).catch(() => {
        if (controller.signal.aborted) return;
        setFailed(true);
      });
    };

    if (typeof IntersectionObserver === 'function' && loadingElement) {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) load();
      }, { rootMargin: '240px' });
      observer.observe(loadingElement);
    } else {
      load();
    }

    onCleanup(() => {
      controller.abort();
      observer?.disconnect();
      if (activeObjectURL) URL.revokeObjectURL(activeObjectURL);
    });
  });

  return (
    <Show
      when={!failed() && objectURL()}
      fallback={(
        <Show
          when={failed()}
          fallback={<div ref={loadingElement} class="flower-message-image" data-loading="true" aria-hidden="true" />}
        >
          <div class="flower-message-file" data-image-fallback="true" role="img" aria-label={`${props.unavailableLabel}: ${props.alt || props.name}`}>
            <FileItemIcon size={24} item={{ name: props.name, type: 'file' }} class="size-6 shrink-0" />
            <span class="flower-message-file-copy">
              <span class="flower-message-file-name">{props.name}</span>
              <span class="flower-message-file-meta">{props.unavailableLabel}</span>
            </span>
          </div>
        </Show>
      )}
    >
      {(url) => (
        <a
          class="flower-message-image"
          href={url()}
          onClick={(event) => {
            event.preventDefault();
            props.onOpen();
          }}
        >
          <img
            src={url()}
            alt={props.alt}
            onError={() => {
              setFailed(true);
            }}
          />
        </a>
      )}
    </Show>
  );
};
