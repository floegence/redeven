// @vitest-environment jsdom

import { Show, createSignal, type Accessor, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@floegence/floe-webapp-core/ui', async original => ({
  ...await original<object>(),
  FloatingWindow: (props: { open: boolean; title: string; children?: JSX.Element }) => (
    <Show when={props.open}><div role="dialog">{props.title}{props.children}</div></Show>
  ),
}));

import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../../flower_ui/src/copy';
import type { FlowerTimelineEntry } from '../../../../../flower_ui/src/flowerTimelineProjection';
import { FlowerTurnTimeline } from '../../../../../flower_ui/src/FlowerTurnTimeline';
import { createFlowerTurnDisclosureStore } from '../../../../../flower_ui/src/flowerTurnDisclosure';
import { createFlowerScrollTailController } from '../../../../../flower_ui/src/flowerScrollTail';
import { SubagentDetailWindow, type SubagentDetailWindowProps } from '../../../../../flower_ui/src/SubagentDetailWindow';

const disposers: Array<() => void> = [];
afterEach(() => {
  while (disposers.length) disposers.pop()?.();
  document.body.innerHTML = '';
});

function entry(key: string, content: string): FlowerTimelineEntry {
  return { type: 'message', key, message: { id: key, turn_id: 'child-turn', role: 'assistant', content, status: 'complete', created_at_ms: 1 },
    blocks: [{ type: 'content', key: key + ':content', block_index: 0, block_type: 'markdown', content }] };
}

function mount(entries: Accessor<readonly FlowerTimelineEntry[]>, overrides: Partial<SubagentDetailWindowProps> = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  disposers.push(render(() => {
    const scroll = createFlowerScrollTailController({ reducedMotionPreferred: () => true, requestAnimationFrame: callback => requestAnimationFrame(callback), cancelAnimationFrame: handle => cancelAnimationFrame(handle) });
    const choices = createFlowerTurnDisclosureStore();
    const props: SubagentDetailWindowProps = {
      open: true, onOpenChange: () => undefined, threadID: 'child', title: 'Inspect sources',
      status: 'running', statusLabel: 'Running', statusIndicator: null,
      elapsedLabel: '12s', description: 'Inspect source evidence.',
      loading: false, error: '', detailAvailable: true, entries: [],
      renderTimeline: () => <FlowerTurnTimeline thread={null} entries={entries()} failureNoticeVisible={false}
        runtimeID="test" scope="subagent" choices={choices} scroll={scroll} reducedMotion={() => true}
        copy={DEFAULT_FLOWER_SURFACE_COPY.chat.turnProcess}
        renderEntry={item => <p data-entry={item().key}>{item().type === 'message' ? (item() as Extract<FlowerTimelineEntry, { type: 'message' }>).message.content : ''}</p>} />,
      bindScroll: scroll.bind, onScroll: scroll.onScroll, onWheel: scroll.onWheel,
      onPointerDown: scroll.onPointerDown, onTouchMove: scroll.onTouchMove,
      showScrollToLatest: false, onScrollToLatest: () => undefined, onRetryLoad: () => undefined,
      viewportLeftInset: 12, zIndex: 1, threadLoadingLabel: 'Loading', scrollToLatestLabel: 'Scroll to latest',
      copy: DEFAULT_FLOWER_SURFACE_COPY.subagents!, ...overrides,
    };
    return <SubagentDetailWindow {...props} entries={entries()} />;
  }, root));
  return root;
}

describe('SubagentDetailWindow shared timeline', () => {
  it('keeps the real shared timeline and keyed message mounted during replacement and append', () => {
    const [entries, setEntries] = createSignal<readonly FlowerTimelineEntry[]>([entry('first', 'Initial work')]);
    const root = mount(entries);
    const timeline = root.querySelector('.flower-turn-timeline');
    const message = root.querySelector('[data-entry="first"]');
    expect(timeline).not.toBeNull();
    setEntries([entry('first', 'Updated work'), entry('second', 'Tool result')]);
    expect(root.querySelector('.flower-turn-timeline')).toBe(timeline);
    expect(root.querySelector('[data-entry="first"]')).toBe(message);
    expect(message?.textContent).toBe('Updated work');
    expect(root.textContent).toContain('Tool result');
    setEntries([entry('second', 'Final result')]);
    expect(message?.isConnected).toBe(false);
    expect(root.textContent).toContain('Final result');
  });

  it('shows a legitimate empty state and retains input controls', () => {
    const root = mount(() => [], { inputControls: <button>Handle request</button> });
    expect(root.querySelector('.flower-subagent-detail-empty')?.textContent).toBe(DEFAULT_FLOWER_SURFACE_COPY.subagents!.emptyDescription);
    expect(root.textContent).toContain('Handle request');
  });

  it('shows loading without an available body', () => {
    const root = mount(() => [], { loading: true, detailAvailable: false });
    expect(root.querySelector('.flower-subagent-detail-loading')?.getAttribute('aria-label')).toBe('Loading');
    expect(root.querySelector('.flower-subagent-detail-transcript')).toBeNull();
  });

  it('offers retry after an unavailable body instead of rendering an empty successful window', () => {
    const retry = vi.fn();
    const root = mount(() => [], { error: 'Unable to load detail', detailAvailable: false, onRetryLoad: retry });
    expect(root.querySelector('.flower-subagent-detail-state-error')?.textContent).toContain('Unable to load detail');
    root.querySelector<HTMLButtonElement>('.flower-subagent-detail-retry')!.click();
    expect(retry).toHaveBeenCalledOnce();
    expect(root.querySelector('.flower-subagent-detail-transcript')).toBeNull();
  });
});
