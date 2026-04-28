// @vitest-environment jsdom

import { batch, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FollowBottomViewportAnchorResolver } from '../chat/scroll/createFollowBottomController';
import type { FollowBottomMode } from '../chat/scroll/createFollowBottomController';
import { CodexTranscript, type CodexTranscriptRowHeightCache } from './CodexTranscript';
import type { CodexOptimisticUserTurn, CodexTranscriptItem } from './types';

const openPreview = vi.fn(async () => undefined);
const readFileBytesOnceMock = vi.fn();
const protocolState: {
  client: () => Record<string, never> | null;
} = {
  client: () => null,
};

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...classes: Array<string | undefined | null | false>) => classes.filter(Boolean).join(' '),
  useLayout: () => ({
    isMobile: () => false,
  }),
  useNotification: () => ({
    error: vi.fn(),
  }),
}));

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => protocolState,
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = () => <span />;
  return {
    ChevronRight: Icon,
    Code: Icon,
    FileText: Icon,
    Sparkles: Icon,
    Terminal: Icon,
  };
});

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  LOCAL_INTERACTION_SURFACE_ATTR: 'data-floe-local-interaction-surface',
  WORKBENCH_WIDGET_ACTIVATION_SURFACE_ATTR: 'data-floe-workbench-widget-activation-surface',
  Tag: (props: any) => <span class={props.class}>{props.children}</span>,
  Button: (props: any) => (
    <button class={props.class} type={props.type ?? 'button'} disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));

vi.mock('../chat/blocks/MarkdownBlock', () => ({
  MarkdownBlock: (props: any) => (
    <div class={props.class} data-markdown-streaming={props.streaming ? 'true' : 'false'}>
      {props.content}
      {props.streaming ? <span data-testid="streaming-cursor">{'\u258B'}</span> : null}
    </div>
  ),
}));

vi.mock('../chat/blocks/ShellBlock', () => ({
  ShellBlock: (props: any) => <div class={props.class}>{props.command}{props.output}</div>,
}));

vi.mock('../chat/blocks/ThinkingBlock', () => ({
  ThinkingBlock: (props: any) => <div class={props.class}>{props.content}</div>,
}));

vi.mock('../chat/status/StreamingCursor', () => ({
  StreamingCursor: () => <span data-testid="streaming-cursor">{'\u258B'}</span>,
}));

vi.mock('../icons/CodexIcon', () => ({
  CodexIcon: (props: any) => <span class={props.class}>Codex</span>,
}));

vi.mock('../widgets/FilePreviewContext', () => ({
  useFilePreviewContext: () => ({
    openPreview,
  }),
}));

vi.mock('../utils/fileStreamReader', () => ({
  readFileBytesOnce: (...args: unknown[]) => readFileBytesOnceMock(...args),
}));

function renderTranscript(items: CodexTranscriptItem[], options?: {
  optimisticUserTurns?: CodexOptimisticUserTurn[];
  showWorkingState?: boolean;
  workingLabel?: string;
  workingFlags?: string[];
  scrollContainer?: HTMLElement | null;
  followBottomMode?: () => FollowBottomMode;
  onViewportAnchorResolverChange?: (resolver: FollowBottomViewportAnchorResolver | null) => void;
  rowHeightCache?: CodexTranscriptRowHeightCache;
  onMeasuredHeightsUpdated?: () => void;
  threadKey?: string;
}) {
  const host = document.createElement('div');
  document.body.append(host);
  const dispose = render(() => (
    <CodexTranscript
      scrollContainer={options?.scrollContainer}
      followBottomMode={options?.followBottomMode}
      onViewportAnchorResolverChange={options?.onViewportAnchorResolverChange}
      rowHeightCache={options?.rowHeightCache}
      onMeasuredHeightsUpdated={options?.onMeasuredHeightsUpdated}
      threadKey={options?.threadKey}
      items={items}
      optimisticUserTurns={options?.optimisticUserTurns}
      showWorkingState={options?.showWorkingState}
      workingLabel={options?.workingLabel}
      workingFlags={options?.workingFlags}
      emptyTitle="Empty"
      emptyBody="Nothing yet."
    />
  ), host);
  return { host, dispose };
}

function createVirtualScrollContainer(clientHeight = 240): HTMLDivElement {
  const element = document.createElement('div');
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    get: () => clientHeight,
  });
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    get: () => 8_000,
  });
  document.body.append(element);
  return element;
}

interface ResizeObserverRecord {
  callback: ResizeObserverCallback;
  targets: Set<Element>;
}

function installResizeObserverHarness() {
  const records: ResizeObserverRecord[] = [];

  class MockResizeObserver {
    private readonly record: ResizeObserverRecord;

    constructor(callback: ResizeObserverCallback) {
      this.record = {
        callback,
        targets: new Set<Element>(),
      };
      records.push(this.record);
    }

    observe(target: Element) {
      this.record.targets.add(target);
    }

    disconnect() {
      this.record.targets.clear();
    }

    unobserve(target: Element) {
      this.record.targets.delete(target);
    }
  }

  vi.stubGlobal('ResizeObserver', MockResizeObserver as unknown as typeof ResizeObserver);

  return {
    notify(target: Element) {
      for (const record of records) {
        if (!record.targets.has(target)) continue;
        const rect = target.getBoundingClientRect();
        record.callback([
          {
            target,
            contentRect: rect,
            contentBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
          } as unknown as ResizeObserverEntry,
        ], {} as ResizeObserver);
      }
    },
  };
}

function createMemoryRowHeightCache(): CodexTranscriptRowHeightCache {
  const rowHeightsByID = new Map<string, number>();
  return {
    readHeights(rowIDs) {
      const nextHeights: Record<string, number> = {};
      for (const rowID of rowIDs) {
        const height = rowHeightsByID.get(rowID);
        if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) continue;
        nextHeights[rowID] = height;
      }
      return nextHeights;
    },
    writeHeight(rowID, height) {
      rowHeightsByID.set(rowID, Math.round(height));
    },
  };
}

function installScrollContainerRect(container: HTMLElement, top: number, height: number): void {
  container.getBoundingClientRect = () => ({
    x: 0,
    y: top,
    width: 320,
    height,
    top,
    bottom: top + height,
    left: 0,
    right: 320,
    toJSON() {
      return {};
    },
  } as DOMRect);
}

function installTranscriptRowRect(
  row: HTMLElement,
  container: HTMLElement,
  metrics: Readonly<{ top: () => number; height: () => number }>,
): void {
  row.getBoundingClientRect = () => {
    const containerRect = container.getBoundingClientRect();
    const top = containerRect.top + metrics.top() - container.scrollTop;
    const height = metrics.height();
    return {
      x: 0,
      y: top,
      width: 320,
      height,
      top,
      bottom: top + height,
      left: 0,
      right: 320,
      toJSON() {
        return {};
      },
    } as DOMRect;
  };
}

function flushAsync(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}

afterEach(() => {
  openPreview.mockReset();
  readFileBytesOnceMock.mockReset();
  protocolState.client = () => null;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('CodexTranscript', () => {
  it('bounds rendered rows to the viewport when an external scroll container is provided', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(16);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const scrollContainer = createVirtualScrollContainer(240);
    const items: CodexTranscriptItem[] = Array.from({ length: 48 }, (_, index) => ({
      id: `item_${index}`,
      type: index % 2 === 0 ? 'userMessage' : 'agentMessage',
      text: `Transcript row ${index}`,
      status: index % 2 === 0 ? undefined : 'completed',
      order: index,
    }));

    const { host, dispose } = renderTranscript(items, { scrollContainer });

    await flushAsync();

    expect(host.querySelectorAll('.codex-transcript-row').length).toBeLessThan(items.length);
    expect(host.textContent).toContain('Transcript row 0');
    expect(host.textContent).not.toContain('Transcript row 47');

    scrollContainer.scrollTop = 4_800;
    scrollContainer.dispatchEvent(new Event('scroll'));
    await flushAsync();

    expect(host.querySelectorAll('.codex-transcript-row').length).toBeLessThan(items.length);
    expect(host.textContent).toContain('Transcript row 47');
    expect(host.textContent).not.toContain('Transcript row 0');

    dispose();
  });

  it('preserves reasoning expansion after a virtualized row leaves and re-enters the viewport', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(16);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const scrollContainer = createVirtualScrollContainer(220);
    const items: CodexTranscriptItem[] = [
      {
        id: 'item_reasoning_virtual',
        type: 'reasoning',
        text: 'Reasoning detail survives virtualization.',
        status: 'completed',
        order: 0,
      },
      ...Array.from({ length: 36 }, (_, index) => ({
        id: `item_filler_${index}`,
        type: index % 2 === 0 ? 'userMessage' : 'agentMessage',
        text: `Filler row ${index}`,
        status: index % 2 === 0 ? undefined : 'completed',
        order: index + 1,
      }) satisfies CodexTranscriptItem),
    ];

    const { host, dispose } = renderTranscript(items, { scrollContainer });

    await flushAsync();

    const toggle = host.querySelector('.codex-chat-reasoning-toggle') as HTMLButtonElement | null;
    expect(toggle).toBeTruthy();
    toggle?.click();
    await flushAsync();
    expect(host.querySelector('[data-codex-reasoning-row="true"]')?.getAttribute('data-codex-reasoning-expanded')).toBe('true');

    scrollContainer.scrollTop = 4_000;
    scrollContainer.dispatchEvent(new Event('scroll'));
    await flushAsync();
    expect(host.querySelector('[data-codex-reasoning-row="true"]')).toBeNull();

    scrollContainer.scrollTop = 0;
    scrollContainer.dispatchEvent(new Event('scroll'));
    await flushAsync();

    expect(host.querySelector('[data-codex-reasoning-row="true"]')?.getAttribute('data-codex-reasoning-expanded')).toBe('true');
    expect(host.textContent).toContain('Reasoning detail survives virtualization.');

    dispose();
  });

  it('preserves a paused viewport when a shell row above it receives its first measurement', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(16);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const resizeObserverHarness = installResizeObserverHarness();
    const scrollContainer = createVirtualScrollContainer(120);
    installScrollContainerRect(scrollContainer, 100, 120);

    const items: CodexTranscriptItem[] = [
      {
        id: 'item_command_1',
        type: 'commandExecution',
        command: 'npm run typecheck',
        aggregated_output: 'done',
        status: 'completed',
        order: 0,
      },
      {
        id: 'item_agent_1',
        type: 'agentMessage',
        text: 'Anchor row',
        status: 'completed',
        order: 1,
      },
      {
        id: 'item_agent_2',
        type: 'agentMessage',
        text: 'Later row',
        status: 'completed',
        order: 2,
      },
    ];

    const { host, dispose } = renderTranscript(items, {
      scrollContainer,
      followBottomMode: () => 'paused',
      threadKey: 'paused-first-measurement',
    });

    await flushAsync();

    const transcriptRows = Array.from(host.querySelectorAll<HTMLElement>('.codex-transcript-row'));
    expect(transcriptRows).toHaveLength(3);

    const rowMetricsByAnchorID = new Map<string, { top: number; height: number }>([
      ['item:item_command_1', { top: 0, height: 144 }],
      ['item:item_agent_1', { top: 144, height: 72 }],
      ['item:item_agent_2', { top: 216, height: 72 }],
    ]);

    for (const row of transcriptRows) {
      const anchorID = String(row.getAttribute('data-follow-bottom-anchor-id') ?? '').trim();
      const metrics = rowMetricsByAnchorID.get(anchorID);
      if (!metrics) continue;
      installTranscriptRowRect(row, scrollContainer, {
        top: () => metrics.top,
        height: () => metrics.height,
      });
    }

    scrollContainer.scrollTop = 90;
    scrollContainer.dispatchEvent(new Event('scroll'));
    await flushAsync();

    resizeObserverHarness.notify(transcriptRows[0]!);
    await flushAsync();

    expect(scrollContainer.scrollTop).toBe(158);

    dispose();
  });

  it('reports measured row-height batches to the caller', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(16);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const resizeObserverHarness = installResizeObserverHarness();
    const onMeasuredHeightsUpdated = vi.fn();

    const { host, dispose } = renderTranscript([
      {
        id: 'item_agent_measured',
        type: 'agentMessage',
        text: 'Measured row',
        status: 'completed',
        order: 0,
      },
    ], {
      threadKey: 'measured-thread',
      onMeasuredHeightsUpdated,
    });

    await flushAsync();

    const row = host.querySelector('.codex-transcript-row') as HTMLElement | null;
    expect(row).not.toBeNull();
    if (!row) {
      throw new Error('row not rendered');
    }

    row.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 320,
      height: 144,
      top: 0,
      bottom: 144,
      left: 0,
      right: 320,
      toJSON() {
        return {};
      },
    } as DOMRect);

    resizeObserverHarness.notify(row);
    await flushAsync();

    expect(onMeasuredHeightsUpdated).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('exposes a virtualized viewport anchor resolver that round-trips the current scroll position', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(16);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const scrollContainer = createVirtualScrollContainer(240);
    const items: CodexTranscriptItem[] = Array.from({ length: 24 }, (_, index) => ({
      id: `item_${index}`,
      type: 'agentMessage',
      text: `Transcript row ${index}`,
      status: 'completed',
      order: index,
    }));

    let resolver: FollowBottomViewportAnchorResolver | null = null;
    const { dispose } = renderTranscript(items, {
      scrollContainer,
      onViewportAnchorResolverChange: (nextResolver) => {
        resolver = nextResolver;
      },
    });

    await flushAsync();

    scrollContainer.scrollTop = 300;
    scrollContainer.dispatchEvent(new Event('scroll'));
    await flushAsync();

    const currentResolver = resolver as FollowBottomViewportAnchorResolver | null;
    const anchor = currentResolver?.capture() ?? null;
    expect(anchor).not.toBeNull();
    expect(anchor?.id).toBe('item:item_2');
    expect(currentResolver?.resolveScrollTop(anchor!)).toBe(300);

    dispose();
  });

  it('does not reuse virtual row heights across threads that share the same item ids', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(16);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const scrollContainer = createVirtualScrollContainer(240);
    const rowHeightCache = createMemoryRowHeightCache();

    const buildItems = (variant: 'large' | 'small'): CodexTranscriptItem[] => Array.from({ length: 24 }, (_, index) => ({
      id: `item_${index}`,
      type: variant === 'large' ? 'fileChange' : 'userMessage',
      text: `${variant} row ${index}`,
      changes: variant === 'large' ? [] : undefined,
      order: index,
    }));

    const host = document.createElement('div');
    document.body.append(host);
    const [threadKey, setThreadKey] = createSignal('thread-large');
    const [items, setItems] = createSignal<CodexTranscriptItem[]>(buildItems('large'));

    const dispose = render(() => (
      <CodexTranscript
        scrollContainer={scrollContainer}
        rowHeightCache={rowHeightCache}
        threadKey={threadKey()}
        items={items()}
        emptyTitle="Empty"
        emptyBody="Nothing yet."
      />
    ), host);

    await flushAsync();

    batch(() => {
      setThreadKey('thread-small');
      setItems(buildItems('small'));
    });
    await flushAsync();

    scrollContainer.scrollTop = (24 * 92) - 240;
    scrollContainer.dispatchEvent(new Event('scroll'));
    await flushAsync();

    const renderedText = Array.from(host.querySelectorAll<HTMLElement>('.codex-transcript-row'))
      .map((row) => String(row.textContent ?? '').trim())
      .filter(Boolean);
    const virtualizedFeed = host.querySelector<HTMLElement>('[data-codex-transcript-virtualized="true"]');
    const virtualizedFeedHeight = Number(
      String(virtualizedFeed?.style.height ?? '').replace(/px$/, ''),
    );

    expect(renderedText.some((text) => text.includes('small row 23'))).toBe(true);
    expect(renderedText.some((text) => text.includes('small row 00'))).toBe(false);
    expect(virtualizedFeedHeight).toBeGreaterThan(0);
    expect(host.querySelector('[aria-hidden="true"][style*="height"]')).toBeNull();

    dispose();
  });

  it('hydrates virtual row heights from the scoped cache before rendering a revisited thread', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(16);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const scrollContainer = createVirtualScrollContainer(240);
    const rowHeightCache = createMemoryRowHeightCache();

    const threadKey = 'thread-large';
    const items: CodexTranscriptItem[] = Array.from({ length: 24 }, (_, index) => ({
      id: `item_${index}`,
      type: 'agentMessage',
      text: `Large row ${index}`,
      status: 'completed',
      order: index,
    }));

    for (const item of items) {
      rowHeightCache.writeHeight(`${threadKey}::item:${item.id}`, 92);
    }

    const { host, dispose } = renderTranscript(items, {
      scrollContainer,
      rowHeightCache,
      threadKey,
    });

    await flushAsync();

    scrollContainer.scrollTop = (items.length * 92) - 240;
    scrollContainer.dispatchEvent(new Event('scroll'));
    await flushAsync();

    const renderedText = Array.from(host.querySelectorAll<HTMLElement>('.codex-transcript-row'))
      .map((row) => String(row.textContent ?? '').trim())
      .filter(Boolean);

    expect(renderedText.some((text) => text.includes('Large row 23'))).toBe(true);
    expect(renderedText.some((text) => text.includes('Large row 0'))).toBe(false);

    dispose();
  });

  it('hydrates cached row heights when a staged thread is revealed after the transcript is already mounted', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(16);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const scrollContainer = createVirtualScrollContainer(240);
    const rowHeightCache = createMemoryRowHeightCache();
    const threadKey = 'thread-staged';
    const items: CodexTranscriptItem[] = Array.from({ length: 24 }, (_, index) => ({
      id: `item_${index}`,
      type: 'agentMessage',
      text: `Staged row ${index}`,
      status: 'completed',
      order: index,
    }));

    for (const item of items) {
      rowHeightCache.writeHeight(`${threadKey}::item:${item.id}`, 92);
    }

    const host = document.createElement('div');
    document.body.append(host);
    const [visibleItems, setVisibleItems] = createSignal<CodexTranscriptItem[]>([]);

    const dispose = render(() => (
      <CodexTranscript
        scrollContainer={scrollContainer}
        rowHeightCache={rowHeightCache}
        threadKey={threadKey}
        items={visibleItems()}
        emptyTitle="Empty"
        emptyBody="Nothing yet."
      />
    ), host);

    await flushAsync();
    setVisibleItems(items);
    await flushAsync();

    const virtualizedFeed = host.querySelector<HTMLElement>('[data-codex-transcript-virtualized="true"]');
    const virtualizedFeedHeight = Number(
      String(virtualizedFeed?.style.height ?? '').replace(/px$/, ''),
    );

    expect(virtualizedFeedHeight).toBe(items.length * 92);

    dispose();
  });

  it('renders a single pending assistant lane with the pre-output cursor above the compact working indicator', () => {
    const { host, dispose } = renderTranscript([], {
      showWorkingState: true,
      workingLabel: 'working',
      workingFlags: ['web search'],
    });
    const rows = Array.from(host.querySelectorAll('.codex-transcript-row'));
    const preOutputRow = host.querySelector('[data-codex-pre-output="true"]')?.closest('.chat-message-item');
    const workingRow = host.querySelector('[data-codex-working-state="true"]')?.closest('.chat-message-item');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.querySelector('[data-codex-pre-output="true"]')).toBeTruthy();
    expect(rows[0]?.querySelector('[data-codex-working-state="true"]')).toBeTruthy();
    expect(host.querySelector('[data-codex-pre-output="true"] [data-testid="streaming-cursor"]')).toBeTruthy();
    expect(preOutputRow).toBe(workingRow);
    expect(preOutputRow?.classList.contains('codex-assistant-lead-aligned-row')).toBe(false);
    expect(preOutputRow?.querySelector('.chat-message-content-wrapper')?.classList.contains('codex-assistant-lead-aligned-content-prelude')).toBe(false);
    expect(preOutputRow?.querySelector('.chat-message-avatar')).toBeNull();
    expect(host.querySelector('[data-codex-working-state="true"]')).toBeTruthy();
    expect(host.textContent).toContain('Working...');
    expect(host.textContent).not.toContain('Codex is');
    expect(host.textContent).not.toContain('web search');
    expect(host.querySelector('.codex-message-run-indicator-graph')).toBeTruthy();
    expect(host.querySelector('[data-codex-working-state="true"] [data-testid="streaming-cursor"]')).toBeNull();
    expect(workingRow?.querySelector('.chat-message-avatar')).toBeNull();
    expect(host.querySelectorAll('.chat-message-avatar')).toHaveLength(0);

    dispose();
  });

  it('hands the streaming cursor over to the real agent message once output starts', () => {
    const { host, dispose } = renderTranscript([
      {
        id: 'item_agent_live',
        type: 'agentMessage',
        text: 'Streaming response',
        status: 'inProgress',
        order: 0,
      },
    ], {
      showWorkingState: true,
      workingLabel: 'working',
    });
    const workingRow = host.querySelector('[data-codex-working-state="true"]')?.closest('.chat-message-item');
    const agentRow = host.querySelector('[data-codex-item-type="agentMessage"]')?.closest('.chat-message-item');

    expect(host.querySelector('[data-codex-pre-output="true"]')).toBeNull();
    expect(host.querySelector('[data-codex-item-type="agentMessage"] [data-markdown-streaming="true"]')).toBeTruthy();
    expect(host.querySelector('[data-codex-item-type="agentMessage"] [data-testid="streaming-cursor"]')).toBeTruthy();
    expect(agentRow?.classList.contains('codex-assistant-lead-aligned-row')).toBe(false);
    expect(agentRow?.querySelector('.chat-message-content-wrapper')?.classList.contains('codex-assistant-lead-aligned-content-markdown')).toBe(false);
    expect(host.querySelector('[data-codex-working-state="true"] [data-testid="streaming-cursor"]')).toBeNull();
    expect(workingRow?.querySelector('.chat-message-avatar')).toBeNull();
    expect(host.querySelectorAll('.chat-message-avatar')).toHaveLength(0);

    dispose();
  });

  it('keeps tool rows avatar-free together with the standalone working row', () => {
    const { host, dispose } = renderTranscript([
      {
        id: 'item_command_live',
        type: 'commandExecution',
        command: 'npm test',
        aggregated_output: 'PASS avatar-handoff',
        status: 'inProgress',
        order: 0,
      },
    ], {
      showWorkingState: true,
      workingLabel: 'working',
    });
    const rows = Array.from(host.querySelectorAll('.codex-transcript-row'));
    const workingRow = host.querySelector('[data-codex-working-state="true"]')?.closest('.chat-message-item');

    expect(host.querySelector('[data-codex-pre-output="true"]')).toBeNull();
    expect(rows[0]?.querySelector('.chat-message-avatar')).toBeNull();
    expect(workingRow?.querySelector('.chat-message-avatar')).toBeNull();
    expect(host.querySelectorAll('.chat-message-avatar')).toHaveLength(0);

    dispose();
  });

  it('keeps the live agent markdown node mounted while append-only content updates for the same item id', async () => {
    const [items, setItems] = createSignal<CodexTranscriptItem[]>([
      {
        id: 'item_agent_live',
        type: 'agentMessage',
        text: 'Streaming response',
        status: 'inProgress',
        order: 0,
      },
    ]);
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => (
      <CodexTranscript
        items={items()}
        emptyTitle="Empty"
        emptyBody="Nothing yet."
      />
    ), host);

    const initialNode = host.querySelector('[data-codex-item-type="agentMessage"] [data-markdown-streaming="true"]');
    expect(initialNode).toBeTruthy();

    setItems([
      {
        id: 'item_agent_live',
        type: 'agentMessage',
        text: 'Streaming response with more detail',
        status: 'inProgress',
        order: 0,
      },
    ]);
    await flushAsync();

    const updatedNode = host.querySelector('[data-codex-item-type="agentMessage"] [data-markdown-streaming="true"]');
    expect(updatedNode).toBe(initialNode);
    expect(updatedNode?.textContent).toContain('Streaming response with more detail');

    setItems([
      {
        id: 'item_agent_live',
        type: 'agentMessage',
        text: 'Streaming response with more detail',
        status: 'completed',
        order: 0,
      },
    ]);
    await flushAsync();

    const completedNode = host.querySelector('[data-codex-item-type="agentMessage"] [data-markdown-streaming="false"]');
    expect(completedNode).toBe(initialNode);

    dispose();
  });

  it('keeps the pre-output cursor visible for a new optimistic turn even when the previous run already has assistant output', () => {
    const { host, dispose } = renderTranscript([
      {
        id: 'item_user_previous',
        type: 'userMessage',
        text: 'Review the previous answer.',
        order: 0,
      },
      {
        id: 'item_agent_previous',
        type: 'agentMessage',
        text: 'Previous assistant answer.',
        order: 1,
      },
    ], {
      optimisticUserTurns: [
        {
          id: 'optimistic_turn_1',
          thread_id: 'thread_1',
          text: 'Please continue.',
          inputs: [],
          after_item_order: 1,
        },
      ],
      showWorkingState: true,
      workingLabel: 'working',
    });

    expect(host.querySelector('[data-codex-pre-output="true"]')).toBeTruthy();
    expect(host.querySelector('[data-codex-pre-output="true"] [data-testid="streaming-cursor"]')).toBeTruthy();
    expect(host.querySelector('[data-codex-pre-output="true"]')?.closest('.chat-message-item')).toBe(
      host.querySelector('[data-codex-working-state="true"]')?.closest('.chat-message-item'),
    );
    expect(host.querySelector('[data-codex-working-state="true"]')?.closest('.chat-message-item')?.querySelector('.chat-message-avatar')).toBeNull();
    expect(host.querySelectorAll('.chat-message-avatar')).toHaveLength(0);

    dispose();
  });

  it('keeps tool rows avatar-free once output arrives for an unresolved optimistic turn', () => {
    const { host, dispose } = renderTranscript([
      {
        id: 'item_user_previous',
        type: 'userMessage',
        text: 'Previous request.',
        order: 0,
      },
      {
        id: 'item_agent_previous',
        type: 'agentMessage',
        text: 'Previous assistant answer.',
        order: 1,
      },
      {
        id: 'item_web_search_live_1',
        type: 'webSearch',
        query: 'weather: Wuhan, Hubei, China',
        action: {
          type: 'search',
          queries: ['weather: Wuhan, Hubei, China'],
        },
        status: 'completed',
        order: 2,
      },
      {
        id: 'item_web_search_live_2',
        type: 'webSearch',
        query: 'weather: Wuhan, Hubei, China',
        action: {
          type: 'search',
          queries: ['weather: Wuhan, Hubei, China'],
        },
        status: 'completed',
        order: 3,
      },
    ], {
      optimisticUserTurns: [
        {
          id: 'optimistic_turn_2',
          thread_id: 'thread_1',
          text: 'Check Wuhan weather.',
          inputs: [],
          after_item_order: 1,
        },
      ],
      showWorkingState: true,
      workingLabel: 'working',
    });
    const webSearchRows = Array.from(host.querySelectorAll('[data-codex-item-type="webSearch"]'));
    const workingRow = host.querySelector('[data-codex-working-state="true"]')?.closest('.chat-message-item');

    expect(host.querySelector('[data-codex-pre-output="true"]')).toBeNull();
    expect(webSearchRows[0]?.closest('.chat-message-item')?.querySelector('.chat-message-avatar')).toBeNull();
    expect(webSearchRows[1]?.closest('.chat-message-item')?.querySelector('.chat-message-avatar')).toBeNull();
    expect(workingRow?.querySelector('.chat-message-avatar')).toBeNull();
    expect(host.querySelectorAll('.chat-message-avatar')).toHaveLength(0);

    dispose();
  });

  it('keeps all assistant-owned transcript rows avatar-free across run boundaries', () => {
    const items: CodexTranscriptItem[] = [
      {
        id: 'item_reasoning_intro',
        type: 'reasoning',
        text: 'Planning the next steps.',
        order: 0,
      },
      {
        id: 'item_agent_first',
        type: 'agentMessage',
        text: 'First assistant message.',
        order: 1,
      },
      {
        id: 'item_web_search',
        type: 'webSearch',
        query: 'codex ui avatar grouping',
        action: {
          type: 'search',
          queries: ['codex ui avatar grouping'],
        },
        order: 2,
      },
      {
        id: 'item_agent_second',
        type: 'agentMessage',
        text: 'Second assistant message.',
        order: 3,
      },
      {
        id: 'item_user_reset',
        type: 'userMessage',
        text: 'Please continue.',
        order: 4,
      },
      {
        id: 'item_agent_after_user',
        type: 'agentMessage',
        text: 'Assistant message after user reset.',
        order: 5,
      },
    ];

    const { host, dispose } = renderTranscript(items);
    const rows = Array.from(host.querySelectorAll('.codex-transcript-row'));

    expect(rows).toHaveLength(6);
    expect(rows[0]?.querySelector('.chat-message-avatar')).toBeNull();
    expect(rows[0]?.querySelector('.chat-message-item')?.classList.contains('codex-assistant-lead-aligned-row')).toBe(false);
    expect(rows[1]?.querySelector('.chat-message-avatar')).toBeNull();
    expect(rows[2]?.querySelector('.chat-message-avatar')).toBeNull();
    expect(rows[3]?.querySelector('.chat-message-avatar')).toBeNull();
    expect(rows[3]?.querySelector('.chat-message-item')?.classList.contains('codex-assistant-lead-aligned-row')).toBe(false);
    expect(rows[4]?.querySelector('.chat-message-avatar')).toBeNull();
    expect(rows[5]?.querySelector('.chat-message-avatar')).toBeNull();
    expect(rows[5]?.querySelector('.chat-message-item')?.classList.contains('codex-assistant-lead-aligned-row')).toBe(false);
    expect(host.querySelectorAll('.chat-message-avatar')).toHaveLength(0);

    dispose();
  });

  it('renders reasoning as a collapsible markdown block and keeps it expanded after completion', async () => {
    const [items, setItems] = createSignal<CodexTranscriptItem[]>([
      {
        id: 'item_reasoning_live',
        type: 'reasoning',
        text: 'Investigating the event replay path.\n\n- Verify resume flow',
        status: 'inProgress',
        order: 0,
      },
    ]);
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => (
      <CodexTranscript
        items={items()}
        emptyTitle="Empty"
        emptyBody="Nothing yet."
      />
    ), host);

    expect(host.querySelector('[data-codex-reasoning-row="true"]')?.getAttribute('data-codex-reasoning-expanded')).toBe('false');
    expect(host.textContent).not.toContain('Reasoning note');
    expect(host.querySelector('.codex-chat-reasoning-card')).toBeNull();
    expect(host.querySelector('.codex-chat-reasoning-toggle .codex-chat-reasoning-kicker')).toBeTruthy();
    expect(host.querySelector('.codex-chat-reasoning-markdown')).toBeNull();

    const toggle = host.querySelector('.codex-chat-reasoning-toggle') as HTMLButtonElement | null;
    toggle?.click();
    await Promise.resolve();

    expect(host.querySelector('[data-codex-reasoning-row="true"]')?.getAttribute('data-codex-reasoning-expanded')).toBe('true');
    expect(host.querySelector('.codex-chat-reasoning-markdown')).toBeTruthy();

    setItems([
      {
        id: 'item_reasoning_live',
        type: 'reasoning',
        text: 'Investigating the event replay path.\n\n- Verify resume flow',
        status: 'completed',
        order: 0,
      },
    ]);
    await Promise.resolve();
    await Promise.resolve();

    expect(host.querySelector('[data-codex-reasoning-row="true"]')?.getAttribute('data-codex-reasoning-expanded')).toBe('true');
    expect(host.textContent).toContain('Investigating the event replay path.');

    toggle?.click();
    await Promise.resolve();

    expect(host.querySelector('[data-codex-reasoning-row="true"]')?.getAttribute('data-codex-reasoning-expanded')).toBe('false');

    dispose();
  });

  it('keeps evidence rows avatar-free, hides empty reasoning rows, and shows web search details instead of a No content fallback', () => {
    const items: CodexTranscriptItem[] = [
      {
        id: 'item_reasoning_empty',
        type: 'reasoning',
        summary: [],
        content: [],
        order: 0,
      },
      {
        id: 'item_web_search',
        type: 'webSearch',
        query: 'site:nmc.cn changsha weather',
        action: {
          type: 'search',
          queries: [
            'site:nmc.cn changsha weather',
            'site:weather.com changsha weather',
          ],
        },
        order: 1,
      },
      {
        id: 'item_web_search_open',
        type: 'webSearch',
        action: {
          type: 'openPage',
          url: 'https://nmc.cn/publish/forecast/AHN/changsha.html',
        },
        order: 2,
      },
      {
        id: 'item_web_search_find',
        type: 'webSearch',
        action: {
          type: 'findInPage',
          pattern: 'Rainfall warning',
          url: 'https://www.weather.com.cn/weather/101250101.shtml',
        },
        order: 3,
      },
    ];

    const { host, dispose } = renderTranscript(items);

    expect(host.textContent).not.toContain('Reasoning note');
    expect(host.textContent).not.toContain('Web search');
    expect(host.textContent).toContain('Search');
    expect(host.textContent).toContain('site:nmc.cn changsha weather');
    expect(host.textContent).toContain('2 queries');
    expect(host.textContent).toContain('Open page');
    expect(host.textContent).toContain('nmc.cn/.../changsha.html');
    expect(host.textContent).toContain('Find in page');
    expect(host.textContent).toContain('Rainfall warning');
    expect(host.textContent).toContain('Page');
    expect(host.textContent).toContain('weather.com.cn/.../101250101.shtml');
    expect(host.textContent).not.toContain('No content.');
    const webSearchRows = host.querySelectorAll('[data-codex-item-type="webSearch"]');

    expect(webSearchRows[0]?.closest('.chat-message-item')?.querySelector('.chat-message-avatar')).toBeNull();
    expect(webSearchRows[1]?.closest('.chat-message-item')?.querySelector('.chat-message-avatar')).toBeNull();
    expect(host.querySelectorAll('.chat-message-avatar')).toHaveLength(0);
    expect(host.querySelector('[data-codex-item-type="webSearch"] .codex-chat-markdown-block')).toBeNull();
    expect(host.querySelector('[data-codex-item-type="webSearch"] .codex-chat-evidence-header')).toBeNull();
    expect(host.querySelector('[data-codex-item-type="webSearch"] .codex-chat-web-search-primary')).toBeTruthy();
    expect(host.querySelector('[data-codex-item-type="webSearch"] .codex-chat-web-search-meta')).toBeTruthy();
    expect(host.querySelector('[data-codex-item-type="webSearch"] .codex-chat-web-search-meta-label')?.textContent).toBe('Across');

    dispose();
  });

  it('renders web search status only when the item has an explicit status', () => {
    const items: CodexTranscriptItem[] = [
      {
        id: 'item_web_search_no_status',
        type: 'webSearch',
        query: 'site:spaceship.com .com domain registration price official',
        action: {
          type: 'search',
          queries: ['site:spaceship.com .com domain registration price official'],
        },
        order: 0,
      },
      {
        id: 'item_web_search_completed',
        type: 'webSearch',
        query: 'https://www.spaceship.com/domains/gtld/com/',
        action: {
          type: 'openPage',
          url: 'https://www.spaceship.com/domains/gtld/com/',
        },
        status: 'completed',
        order: 1,
      },
    ];

    const { host, dispose } = renderTranscript(items);
    const rows = host.querySelectorAll('[data-codex-item-type="webSearch"]');

    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('.codex-chat-web-search-status')).toBeNull();
    expect(rows[1]?.querySelector('.codex-chat-web-search-status')).toBeTruthy();
    expect(rows[1]?.textContent?.toLowerCase()).toContain('completed');

    dispose();
  });

  it('renders command execution rows as direct shell blocks without the extra evidence header wrapper', () => {
    const { host, dispose } = renderTranscript([
      {
        id: 'item_command',
        type: 'commandExecution',
        command: 'pnpm test',
        aggregated_output: 'PASS CodexTranscript.test.tsx',
        status: 'completed',
        exit_code: 0,
        order: 0,
      },
    ]);

    expect(host.textContent).toContain('pnpm test');
    expect(host.textContent).toContain('PASS CodexTranscript.test.tsx');
    expect(host.textContent).not.toContain('Command evidence');
    expect(host.querySelector('.codex-chat-evidence-card')).toBeNull();

    dispose();
  });

  it('renders user-authored text as raw text instead of markdown or HTML', () => {
    const rawText = '<div class="demo">literal html</div>\n# not a heading\n[not a link](/tmp/demo.txt)';
    const { host, dispose } = renderTranscript([
      {
        id: 'item_user_raw',
        type: 'userMessage',
        text: '',
        inputs: [
          {
            type: 'text',
            text: rawText,
          },
        ],
        order: 0,
      },
    ]);

    const userRow = host.querySelector('[data-codex-item-type="userMessage"]');
    const rawBlock = host.querySelector('.codex-chat-user-raw-text');

    expect(rawBlock?.textContent).toBe(rawText);
    expect(userRow?.querySelector('a')).toBeNull();
    expect(userRow?.querySelector('h1')).toBeNull();
    expect(userRow?.querySelector('.codex-chat-markdown-block')).toBeNull();

    dispose();
  });

  it('renders structured user inputs in source order and keeps remote image thumbnails inline', () => {
    const { host, dispose } = renderTranscript([
      {
        id: 'item_user_structured',
        type: 'userMessage',
        text: '',
        inputs: [
          { type: 'text', text: 'before image' },
          { type: 'image', url: 'data:image/png;base64,AAAA', name: 'diagram.png' },
          { type: 'text', text: 'after image' },
        ],
        order: 0,
      },
    ]);

    const userContent = host.querySelector('.codex-chat-user-content');
    const inputTypes = Array.from(userContent?.children ?? []).map((element) => element.getAttribute('data-codex-user-input-type'));
    const image = host.querySelector('.codex-chat-user-image') as HTMLImageElement | null;

    expect(inputTypes).toEqual(['text', 'image', 'text']);
    expect(image?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(image?.getAttribute('alt')).toBe('diagram.png');

    dispose();
  });

  it('opens the file preview when a structured local file input is clicked', async () => {
    const { host, dispose } = renderTranscript([
      {
        id: 'item_user_skill',
        type: 'userMessage',
        text: '',
        inputs: [
          {
            type: 'skill',
            name: 'checks',
            path: '/workspace/.codex/skills/checks/SKILL.md',
          },
        ],
        order: 0,
      },
    ]);

    const skillButton = host.querySelector('[data-codex-user-input-type="skill"]');
    skillButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(openPreview).toHaveBeenCalledWith({
      id: '/workspace/.codex/skills/checks/SKILL.md',
      name: 'checks',
      path: '/workspace/.codex/skills/checks/SKILL.md',
      type: 'file',
    });

    dispose();
  });

  it('renders fallback user text together with file mention cards and opens the file preview', async () => {
    const { host, dispose } = renderTranscript([
      {
        id: 'item_user_file_mention',
        type: 'userMessage',
        text: 'Review this implementation.',
        inputs: [
          {
            type: 'mention',
            name: 'CodexComposerShell.tsx',
            path: '/workspace/src/ui/codex/CodexComposerShell.tsx',
          },
        ],
        order: 0,
      },
    ]);

    expect(host.textContent).toContain('Review this implementation.');
    const fileButton = host.querySelector('[data-codex-user-input-type="mention"]');
    expect(fileButton?.textContent).toContain('CodexComposerShell.tsx');

    fileButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(openPreview).toHaveBeenCalledWith({
      id: '/workspace/src/ui/codex/CodexComposerShell.tsx',
      name: 'CodexComposerShell.tsx',
      path: '/workspace/src/ui/codex/CodexComposerShell.tsx',
      type: 'file',
    });

    dispose();
  });

  it('loads a local image thumbnail and still routes clicks into the file preview surface', async () => {
    protocolState.client = () => ({});
    readFileBytesOnceMock.mockResolvedValue({
      bytes: new Uint8Array([137, 80, 78, 71]),
      meta: {
        ok: true,
        content_len: 4,
        truncated: false,
      },
    });

    const createObjectURL = vi.fn(() => 'blob:local-image-preview');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(globalThis.URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });

    const { host, dispose } = renderTranscript([
      {
        id: 'item_user_local_image',
        type: 'userMessage',
        text: '',
        inputs: [
          {
            type: 'localImage',
            name: 'mock.png',
            path: '/workspace/mock.png',
          },
        ],
        order: 0,
      },
    ]);

    await flushAsync();

    const image = host.querySelector('.codex-chat-user-local-image') as HTMLImageElement | null;
    const card = host.querySelector('[data-codex-user-input-type="localImage"]');

    expect(readFileBytesOnceMock).toHaveBeenCalledWith({
      client: {},
      path: '/workspace/mock.png',
      maxBytes: 20 * 1024 * 1024,
    });
    expect(image?.getAttribute('src')).toBe('blob:local-image-preview');

    card?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(openPreview).toHaveBeenCalledWith({
      id: '/workspace/mock.png',
      name: 'mock.png',
      path: '/workspace/mock.png',
      type: 'file',
    });

    dispose();
  });

  it('renders file changes through a git-style Codex diff block instead of a raw preformatted dump', () => {
    const { host, dispose } = renderTranscript([
      {
        id: 'item_file_change',
        type: 'fileChange',
        changes: [
          {
            path: 'src/ui/codex/CodexFileChangeDiff.tsx',
            kind: 'new',
            diff: [
              'export function Example() {',
              '  return <div />;',
              '}',
            ].join('\n'),
          },
        ],
        order: 0,
      },
    ]);

    expect(host.querySelector('.codex-chat-file-change')).toBeTruthy();
    expect(host.querySelector('.codex-chat-diff-pre')).toBeNull();
    expect(host.textContent).toContain('src/ui/codex/CodexFileChangeDiff.tsx');
    expect(host.textContent).toContain('Added');
    expect(host.textContent).toContain('+3 / −0');
    expect(host.textContent).toContain('+export function Example() {');
    expect(host.textContent).toContain('+  return <div />;');
    expect(host.textContent).not.toContain('Copy Patch');
    expect(host.querySelectorAll('.redeven-surface-panel').length).toBeGreaterThan(0);

    dispose();
  });
});
