// MermaidBlock — mermaid diagram rendering using lazy-loaded mermaid library.

import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import type { Component } from 'solid-js';
import { cn, deferAfterPaint, useTheme } from '@floegence/floe-webapp-core';

import { isLargeMermaidDiagram } from '../responsiveness';
import { useI18n } from '../../i18n';
import { renderMermaidSvg, resolveMermaidThemeContext } from '../../file-markdown/mermaidPlugin';

export interface MermaidBlockProps {
  content: string;
  class?: string;
}

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

// Incremental counter for unique mermaid render IDs
let mermaidIdCounter = 0;

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
  const i18n = useI18n();
  const theme = useTheme();
  const [svg, setSvg] = createSignal<string>('');
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string>('');
  let renderRequestSeq = 0;

  createEffect(() => {
    const content = props.content;
    const resolvedTheme = theme.resolvedTheme();
    const shellTheme = theme.shellPresetForMode(resolvedTheme)?.name ?? resolvedTheme;
    const mermaidTheme = resolveMermaidThemeContext(document.documentElement, resolvedTheme, shellTheme);
    const seq = (renderRequestSeq += 1);
    let disposed = false;
    let cancelScheduledRender = () => {};

    if (!content) {
      setSvg('');
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

        void (async () => {
          try {
            const id = `mermaid-${++mermaidIdCounter}`;
            const renderedSvg = await renderMermaidSvg(content, id, mermaidTheme);
            if (disposed || seq !== renderRequestSeq) return;
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
        })();
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
          <span class="chat-mermaid-loading-text">{i18n.t('uiCopy.chat.renderingDiagram')}</span>
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
