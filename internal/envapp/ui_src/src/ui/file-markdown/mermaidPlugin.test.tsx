// @vitest-environment jsdom
import { createContext, createRoot, onCleanup, useContext } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runMermaid } from './mermaidPlugin';
import { diagramEnUS } from '../../../../../flower_ui/src/chat/markdown/diagramCopy';

const state = vi.hoisted(() => ({ disposed: 0 }));
const Context = createContext('missing');
vi.mock('@floegence/floe-webapp-core/diagrams', () => ({
  Diagram: (props: { source: string; labels: { source: string } }) => {
    const context = useContext(Context);
    onCleanup(() => { state.disposed++; });
    return <div data-context={context}><button>{props.labels.source}</button><code>{props.source}</code></div>;
  },
}));
afterEach(() => { document.body.replaceChildren(); state.disposed = 0; });
const fixture = () => {
  const root = document.createElement('div');
  root.innerHTML = '<div class="mermaid" data-mermaid-src="flowchart%20LR%0AA--%3EB">original placeholder</div>';
  document.body.append(root); return root;
};
describe('Markdown diagram adapter', () => {
  it('replaces the placeholder, preserves source and disposes each mounted owner once', async () => {
    const root = fixture();
    const dispose = await runMermaid(root, { labels: () => diagramEnUS });
    expect(root.textContent).not.toContain('original placeholder');
    expect(root.querySelector('code')?.textContent).toBe('flowchart LR\nA-->B');
    expect(root.querySelector('button')?.textContent).toBe('Source');
    dispose(); dispose(); expect(state.disposed).toBe(1);
  });
  it('does not mount stale or disconnected documents', async () => {
    const root = fixture();
    await runMermaid(root, { labels: () => diagramEnUS, shouldContinue: () => false });
    expect(root.querySelector('button')).toBeNull();
    root.remove(); await runMermaid(root, { labels: () => diagramEnUS });
    expect(root.textContent).toBe('original placeholder');
  });
  it('unwinds earlier mounts when a malformed placeholder fails', async () => {
    const root = fixture();
    root.insertAdjacentHTML('beforeend', '<div class="mermaid" data-mermaid-src="%ZZ"></div>');
    await expect(runMermaid(root, { labels: () => diagramEnUS })).rejects.toThrow();
    expect(state.disposed).toBe(1);
  });
  it('inherits host ownership for nested dialog placement', async () => {
    const root = fixture();
    let cleanup!: () => void;
    let pending!: Promise<() => void>;
    createRoot(dispose => { cleanup = dispose;
      Context.Provider({ value: 'workbench', get children() { pending = runMermaid(root, { labels: () => diagramEnUS }); return null; } });
    });
    const dispose = await pending;
    expect(root.querySelector('[data-context]')?.getAttribute('data-context')).toBe('workbench');
    dispose(); cleanup();
  });
});
