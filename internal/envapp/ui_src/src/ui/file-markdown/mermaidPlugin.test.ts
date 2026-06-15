// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMermaid, setupMermaid } from './mermaidPlugin';

const initializeMock = vi.hoisted(() => vi.fn());
const renderMock = vi.hoisted(() => vi.fn());

vi.mock('mermaid', () => ({
  default: {
    initialize: initializeMock,
    render: renderMock,
  },
}));

describe('mermaidPlugin', () => {
  beforeEach(() => {
    setupMermaid('light');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('does not write delayed Mermaid SVG into stale markdown roots', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<div class="mermaid" data-mermaid-src="graph%20TD%0AA--%3EB">graph TD\nA-->B</div>';
    document.body.appendChild(root);

    let resolveRender!: () => void;
    let current = true;
    renderMock.mockImplementationOnce(async () => new Promise<{ svg: string }>((resolve) => {
      resolveRender = () => resolve({ svg: '<svg data-testid="rendered-mermaid"></svg>' });
    }));

    const run = runMermaid(root, { shouldContinue: () => current });
    await vi.waitFor(() => {
      expect(renderMock).toHaveBeenCalledTimes(1);
    });

    current = false;
    resolveRender();
    await run;

    const mermaidElement = root.querySelector<HTMLElement>('.mermaid');
    expect(mermaidElement?.querySelector('svg')).toBeNull();
    expect(mermaidElement?.textContent).toContain('graph TD');
    expect(document.body.querySelector('.file-markdown-body')).toBeNull();
  });

  it('writes Mermaid SVG only while the markdown root remains current', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<div class="mermaid" data-mermaid-src="graph%20TD%0AA--%3EB">graph TD\nA-->B</div>';
    document.body.appendChild(root);
    renderMock.mockResolvedValueOnce({ svg: '<svg data-testid="rendered-mermaid"></svg>' });

    await runMermaid(root, { shouldContinue: () => true });

    const mermaidElement = root.querySelector<HTMLElement>('.mermaid');
    expect(mermaidElement?.querySelector('svg')?.getAttribute('data-testid')).toBe('rendered-mermaid');
    expect(document.body.querySelector('.file-markdown-body')).toBeNull();
  });
});
