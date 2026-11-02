import { getOwner, type Owner } from 'solid-js';
import { render } from 'solid-js/web';
import { Diagram, type DiagramLabels } from '@floegence/floe-webapp-core/diagrams';
import { writeTextToClipboard } from '../utils/clipboard';

export interface MermaidRunOptions {
  shouldContinue?: () => boolean;
  labels: () => DiagramLabels;
  owner?: Owner | null;
}

/** Product adapter only: Floe owns rendering, themes, controls and cleanup. */
export async function runMermaid(root: HTMLElement, options: MermaidRunOptions): Promise<() => void> {
  const cleanups: (() => void)[] = [];
  const dispose = () => { for (const cleanup of cleanups.splice(0)) cleanup(); };
  const owner = options.owner ?? getOwner();
  if (options.shouldContinue?.() === false || !root.isConnected) return dispose;
  try {
    for (const element of root.querySelectorAll<HTMLElement>('.mermaid[data-mermaid-src]')) {
      if (options.shouldContinue?.() === false || !root.isConnected) { dispose(); break; }
      const source = decodeURIComponent(element.dataset.mermaidSrc ?? '');
      element.replaceChildren();
      cleanups.push(render(() => <Diagram source={source} labels={options.labels()} onCopy={writeTextToClipboard} />, element, undefined, { owner }));
    }
  } catch (error) { dispose(); throw error; }
  return dispose;
}
