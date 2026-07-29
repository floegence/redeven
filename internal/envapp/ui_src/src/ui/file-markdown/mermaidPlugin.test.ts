// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  renderMermaidSvg,
  runMermaid,
  type MermaidThemeContext,
} from './mermaidPlugin';

const initializeMock = vi.hoisted(() => vi.fn());
const renderMock = vi.hoisted(() => vi.fn());

vi.mock('mermaid', () => ({
  default: {
    initialize: initializeMock,
    render: renderMock,
  },
}));

function createTheme(preset: string, primaryColor: string): MermaidThemeContext {
  return {
    key: `${preset}|dark|${primaryColor}`,
    mode: 'dark',
    preset,
    variables: { primaryColor },
  };
}

describe('mermaidPlugin', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('keeps cached SVGs isolated between shell presets', async () => {
    renderMock
      .mockResolvedValueOnce({ svg: '<svg data-theme="midnight"></svg>' })
      .mockResolvedValueOnce({ svg: '<svg data-theme="aurora"></svg>' });

    const midnight = await renderMermaidSvg('graph TD\nThemeA-->ThemeB', 'midnight-id', createTheme('midnight', '#111111'));
    const aurora = await renderMermaidSvg('graph TD\nThemeA-->ThemeB', 'aurora-id', createTheme('aurora', '#eeeeee'));

    expect(midnight).toContain('data-theme="midnight"');
    expect(aurora).toContain('data-theme="aurora"');
    expect(renderMock).toHaveBeenCalledTimes(2);
    expect(initializeMock).toHaveBeenLastCalledWith(expect.objectContaining({
      themeVariables: { primaryColor: '#eeeeee' },
    }));
  });

  it('serializes theme initialization with rendering and caches the matching SVG', async () => {
    const midnightTheme = createTheme('queued-midnight', '#111111');
    const auroraTheme = createTheme('queued-aurora', '#eeeeee');
    let activePrimaryColor = '';
    let resolveMidnight!: () => void;

    initializeMock.mockImplementation((config: { themeVariables?: { primaryColor?: string } }) => {
      activePrimaryColor = config.themeVariables?.primaryColor ?? '';
    });
    renderMock
      .mockImplementationOnce(() => new Promise<{ svg: string }>((resolve) => {
        resolveMidnight = () => resolve({ svg: `<svg data-primary="${activePrimaryColor}"></svg>` });
      }))
      .mockImplementationOnce(async () => ({ svg: `<svg data-primary="${activePrimaryColor}"></svg>` }));

    const midnight = renderMermaidSvg('graph TD\nQueuedA-->QueuedB', 'queued-midnight-id', midnightTheme);
    await vi.waitFor(() => {
      expect(renderMock).toHaveBeenCalledTimes(1);
    });

    const aurora = renderMermaidSvg('graph TD\nQueuedA-->QueuedB', 'queued-aurora-id', auroraTheme);
    await Promise.resolve();

    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(initializeMock).toHaveBeenLastCalledWith(expect.objectContaining({
      themeVariables: { primaryColor: '#111111' },
    }));

    resolveMidnight();
    await expect(midnight).resolves.toContain('data-primary="#111111"');
    await expect(aurora).resolves.toContain('data-primary="#eeeeee"');

    const cachedMidnight = await renderMermaidSvg(
      'graph TD\nQueuedA-->QueuedB',
      'cached-midnight-id',
      midnightTheme,
    );
    expect(cachedMidnight).toContain('data-primary="#111111"');
    expect(renderMock).toHaveBeenCalledTimes(2);
  });

  it('drops invalidated queued renders before initialization and cache writes', async () => {
    const blockingTheme = createTheme('blocking', '#111111');
    const staleTheme = createTheme('stale', '#eeeeee');
    let resolveBlocking!: () => void;
    let current = true;

    renderMock.mockImplementationOnce(() => new Promise<{ svg: string }>((resolve) => {
      resolveBlocking = () => resolve({ svg: '<svg data-theme="blocking"></svg>' });
    }));

    const blocking = renderMermaidSvg('graph TD\nBlockA-->BlockB', 'blocking-id', blockingTheme);
    await vi.waitFor(() => {
      expect(renderMock).toHaveBeenCalledTimes(1);
    });
    const stale = renderMermaidSvg('graph TD\nStaleA-->StaleB', 'stale-id', staleTheme, {
      shouldContinue: () => current,
    });

    current = false;
    resolveBlocking();

    await expect(blocking).resolves.toContain('data-theme="blocking"');
    await expect(stale).resolves.toBeNull();
    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(initializeMock).not.toHaveBeenCalledWith(expect.objectContaining({
      themeVariables: { primaryColor: '#eeeeee' },
    }));
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

    const run = runMermaid(root, {
      shouldContinue: () => current,
      theme: createTheme('stale-root', '#111111'),
    });
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

    await runMermaid(root, {
      shouldContinue: () => true,
      theme: createTheme('current-root', '#222222'),
    });

    const mermaidElement = root.querySelector<HTMLElement>('.mermaid');
    expect(mermaidElement?.querySelector('svg')?.getAttribute('data-testid')).toBe('rendered-mermaid');
    expect(document.body.querySelector('.file-markdown-body')).toBeNull();
  });
});
