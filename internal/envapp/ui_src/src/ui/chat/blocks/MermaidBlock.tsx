// MermaidBlock — mermaid diagram rendering using lazy-loaded mermaid library.

import { createSignal, createEffect, Show, onMount } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

export interface MermaidBlockProps {
  content: string;
  class?: string;
}

// Incremental counter for unique mermaid render IDs
let mermaidIdCounter = 0;

// Lazy-loaded mermaid instance
let mermaidPromise: Promise<any> | null = null;
let mermaidInitialized = false;

function getMermaid(): Promise<any> {
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

/**
 * Renders a mermaid diagram. Shows a loading skeleton while the library loads
 * and the diagram renders, and an error message if rendering fails.
 */
export const MermaidBlock: Component<MermaidBlockProps> = (props) => {
  const [svg, setSvg] = createSignal<string>('');
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string>('');

  // Render mermaid diagram when content changes
  createEffect(() => {
    const content = props.content;
    if (!content) {
      setSvg('');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    getMermaid().then(async (mermaid) => {
      if (!mermaid) {
        setError('Failed to load mermaid library');
        setLoading(false);
        return;
      }

      try {
        const id = `mermaid-${++mermaidIdCounter}`;
        const { svg: renderedSvg } = await mermaid.render(id, content);
        setSvg(renderedSvg);
        setError('');
      } catch (err) {
        console.error('Mermaid render error:', err);
        setError(err instanceof Error ? err.message : 'Failed to render diagram');
        setSvg('');
      } finally {
        setLoading(false);
      }
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
