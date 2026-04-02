// MermaidBlock — mermaid diagram rendering using lazy-loaded mermaid library.

import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import type { Component } from 'solid-js';
import { cn, deferAfterPaint } from '@floegence/floe-webapp-core';

import { isLargeMermaidDiagram } from '../responsiveness';

export interface MermaidBlockProps {
  content: string;
  class?: string;
}

type MermaidModule = Awaited<typeof import('mermaid')>['default'];
type IdleCallbackHandle = number;
type IdleDeadlineLike = Readonly<{
  didTimeout: boolean;
  timeRemaining: () => number;
}>;
type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: (deadline: IdleDeadlineLike) => void,
    options?: { timeout: number },
  ) => IdleCallbackHandle;
  cancelIdleCallback?: (handle: IdleCallbackHandle) => void;
};

const MAX_MERMAID_CACHE_SIZE = 64;

// Incremental counter for unique mermaid render IDs
let mermaidIdCounter = 0;

// Lazy-loaded mermaid instance
let mermaidPromise: Promise<MermaidModule | null> | null = null;
let mermaidInitialized = false;
const mermaidSvgCache = new Map<string, string>();

function cacheMermaidSvg(content: string, svg: string): void {
  if (mermaidSvgCache.size >= MAX_MERMAID_CACHE_SIZE) {
    const firstKey = mermaidSvgCache.keys().next().value;
    if (firstKey) {
      mermaidSvgCache.delete(firstKey);
    }
  }

  mermaidSvgCache.set(content, svg);
}

function getMermaid(): Promise<MermaidModule | null> {
  if (mermaidPromise) return mermaidPromise;

  mermaidPromise = import('mermaid')
    .then((mod) => {
      const mermaid = mod.default;
      if (!mermaidInitialized) {
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'strict',
        });
        mermaidInitialized = true;
      }
      return mermaid;
    })
    .catch((err) => {
      console.error('Failed to load mermaid:', err);
      mermaidPromise = null;
      return null;
    });

  return mermaidPromise;
}

function scheduleMermaidRender(task: () => void, preferIdle: boolean): () => void {
  if (typeof window === 'undefined') {
    task();
    return () => {};
  }

  const idleWindow = window as IdleWindow;

  if (preferIdle && typeof idleWindow.requestIdleCallback === 'function') {
    const handle = idleWindow.requestIdleCallback(() => task(), { timeout: 120 });
    return () => {
      idleWindow.cancelIdleCallback?.(handle);
    };
  }

  if (typeof window.requestAnimationFrame === 'function') {
    const frame = window.requestAnimationFrame(() => task());
    return () => {
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(frame);
      }
    };
  }

  const timeout = window.setTimeout(task, 0);
  return () => window.clearTimeout(timeout);
}

/**
 * Renders a mermaid diagram. Shows a loading skeleton while the library loads
 * and the diagram renders, and an error message if rendering fails.
 */
export const MermaidBlock: Component<MermaidBlockProps> = (props) => {
  const [svg, setSvg] = createSignal<string>('');
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string>('');
  let renderRequestSeq = 0;

  createEffect(() => {
    const content = props.content;
    const seq = (renderRequestSeq += 1);
    let disposed = false;
    let cancelScheduledRender = () => {};

    if (!content) {
      setSvg('');
      setError('');
      setLoading(false);
      return;
    }

    const cachedSvg = mermaidSvgCache.get(content);
    if (cachedSvg) {
      setSvg(cachedSvg);
      setError('');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    setSvg('');

    deferAfterPaint(() => {
      if (disposed || seq !== renderRequestSeq) return;

      cancelScheduledRender = scheduleMermaidRender(() => {
        if (disposed || seq !== renderRequestSeq) return;

        void getMermaid().then(async (mermaid) => {
          if (disposed || seq !== renderRequestSeq) return;

          if (!mermaid) {
            setError('Failed to load mermaid library');
            setLoading(false);
            return;
          }

          try {
            const id = `mermaid-${++mermaidIdCounter}`;
            const { svg: renderedSvg } = await mermaid.render(id, content);
            if (disposed || seq !== renderRequestSeq) return;
            cacheMermaidSvg(content, renderedSvg);
            setSvg(renderedSvg);
            setError('');
          } catch (renderError) {
            if (disposed || seq !== renderRequestSeq) return;
            console.error('Mermaid render error:', renderError);
            setError(renderError instanceof Error ? renderError.message : 'Failed to render diagram');
            setSvg('');
          } finally {
            if (!disposed && seq === renderRequestSeq) {
              setLoading(false);
            }
          }
        });
      }, isLargeMermaidDiagram(content));
    });

    onCleanup(() => {
      disposed = true;
      cancelScheduledRender();
    });
  });

  return (
    <div class={cn('chat-mermaid-block', props.class)}>
      <Show when={loading()}>
        <div class="chat-mermaid-loading">
          <span class="chat-mermaid-loading-text">Rendering diagram...</span>
        </div>
      </Show>

      <Show when={error()}>
        <div class="chat-mermaid-error">
          <span class="chat-mermaid-error-icon">!</span>
          <span class="chat-mermaid-error-text">{error()}</span>
        </div>
      </Show>

      <Show when={svg()}>
        <div
          class="chat-mermaid-content"
          // eslint-disable-next-line solid/no-innerhtml
          innerHTML={svg()}
        />
      </Show>
    </div>
  );
};

export default MermaidBlock;
