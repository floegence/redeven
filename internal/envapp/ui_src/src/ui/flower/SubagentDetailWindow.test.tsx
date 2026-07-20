// @vitest-environment jsdom

import { For, Show, createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = (props: { class?: string }) => <span data-icon class={props.class} />;
  return { AlertTriangle: Icon, Bot: Icon, ChevronDown: Icon, Clock: Icon, Refresh: Icon };
});

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  FloatingWindow: (props: { open: boolean; title: string; class?: string; children?: JSX.Element }) => (
    <Show when={props.open}>
      <div role="dialog" class={props.class}>
        <span>{props.title}</span>
        {props.children}
      </div>
    </Show>
  ),
}));

import type { FlowerActivityItem, FlowerActivityStatus } from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../../flower_ui/src/copy';
import type { FlowerTimelineEntry } from '../../../../../flower_ui/src/flowerTimelineProjection';
import { SubagentDetailWindow, type SubagentDetailWindowProps } from '../../../../../flower_ui/src/SubagentDetailWindow';

const disposers: Array<() => void> = [];

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  document.body.innerHTML = '';
});

function activityEntry(key: string, timestamp: number, status: FlowerActivityStatus, label = key): FlowerTimelineEntry {
  const item: FlowerActivityItem = {
    item_id: `${key}-item`,
    tool_id: `${key}-tool`,
    tool_name: 'web.fetch',
    kind: 'tool',
    status,
    severity: status === 'error' ? 'error' : 'quiet',
    needs_attention: status === 'error',
    requires_approval: false,
    label,
  };
  return {
    type: 'message',
    key,
    message: { id: key, turn_id: key, role: 'assistant', content: '', status: 'complete', created_at_ms: timestamp },
    blocks: [{
      type: 'activity',
      key: `${key}:activity`,
      block_index: 0,
      block: {
        type: 'activity-timeline',
        schema_version: 1,
        run_id: 'run-1',
        turn_id: 'turn-1',
        summary: {
          status,
          severity: item.severity,
          needs_attention: item.needs_attention,
          total_items: 1,
          counts: { [status]: 1 },
        },
        items: [item],
      },
    }],
  };
}

function narrativeEntry(key: string, timestamp: number, content: string): FlowerTimelineEntry {
  return {
    type: 'message',
    key,
    message: { id: key, turn_id: key, role: 'assistant', content, status: 'complete', created_at_ms: timestamp },
    blocks: [{ type: 'content', key: `${key}:content`, block_index: 0, block_type: 'markdown', content }],
  };
}

function renderEntry(entry: FlowerTimelineEntry) {
  if (entry.type !== 'message') return null;
  const activityItems = entry.blocks.flatMap((block) => block.type === 'activity' ? block.block.items : []);
  if (activityItems.length > 0) {
    return (
      <For each={activityItems}>{(item) => (
        <button type="button" data-test-tool={item.item_id}>{item.label}</button>
      )}</For>
    );
  }
  return <p>{entry.message.content}</p>;
}

function windowProps(entries: readonly FlowerTimelineEntry[]): SubagentDetailWindowProps {
  return {
    open: true,
    onOpenChange: () => undefined,
    title: 'Inspect sources',
    status: 'running',
    statusLabel: 'Running',
    statusIndicator: <span aria-hidden="true">*</span>,
    agentTypeLabel: 'Explore',
    elapsedLabel: '12s',
    description: 'Inspect source evidence.',
    loading: false,
    error: '',
    detailAvailable: true,
    entries,
    renderEntry,
    bindScroll: () => undefined,
    onScroll: () => undefined,
    showScrollToLatest: false,
    onScrollToLatest: () => undefined,
    hasMore: false,
    loadingMore: false,
    onLoadMore: () => undefined,
    onRetryLoad: () => undefined,
    modelStatus: null,
    tailLoading: false,
    tailError: '',
    onRetryTail: () => undefined,
    viewportLeftInset: 12,
    zIndex: 1,
    threadLoadingLabel: 'Loading',
    scrollToLatestLabel: 'Scroll to latest',
    copy: DEFAULT_FLOWER_SURFACE_COPY.subagents!,
  };
}

describe('SubagentDetailWindow operation phases', () => {
  it('renders one heading for adjacent tools and a direct node for a single-tool phase', () => {
    const entries = [
      narrativeEntry('analysis-1', 100, 'Inspect the first sources.'),
      activityEntry('activity-1', 110, 'success', 'Fetch first source'),
      activityEntry('activity-2', 120, 'success', 'Fetch second source'),
      activityEntry('activity-3', 130, 'success', 'Fetch third source'),
      narrativeEntry('analysis-2', 200, 'Refine the search.'),
      activityEntry('activity-4', 210, 'success', 'Fetch fourth source'),
    ];
    const root = document.createElement('div');
    document.body.append(root);
    disposers.push(render(() => <SubagentDetailWindow {...windowProps(entries)} />, root));

    const activityNodes = root.querySelectorAll('[data-flower-subagent-ledger-kind="activity"]');
    const batch = activityNodes[0];
    const single = activityNodes[1];
    expect(activityNodes).toHaveLength(2);
    expect(batch?.textContent).toContain('3 operations');
    expect(batch?.querySelectorAll('[data-test-tool]')).toHaveLength(3);
    expect(single?.hasAttribute('data-flower-subagent-single-operation')).toBe(true);
    expect(single?.textContent).not.toContain('1 operation');
    expect(single?.querySelector('[data-test-tool="activity-4-item"]')).toBeTruthy();
  });

  it('preserves the user disclosure choice when live tools append and change status', async () => {
    const [entries, setEntries] = createSignal<readonly FlowerTimelineEntry[]>([
      activityEntry('activity-1', 100, 'success', 'Fetch first source'),
      activityEntry('activity-2', 110, 'running', 'Fetch second source'),
    ]);
    const root = document.createElement('div');
    document.body.append(root);
    disposers.push(render(() => <SubagentDetailWindow {...windowProps(entries())} />, root));

    const phase = root.querySelector('details[data-flower-subagent-ledger-kind="activity"]') as HTMLDetailsElement;
    expect(phase.open).toBe(true);
    expect(phase.textContent).toContain('2 operations');
    phase.open = false;
    phase.dispatchEvent(new Event('toggle'));

    setEntries([
      activityEntry('activity-1', 100, 'success', 'Fetch first source'),
      activityEntry('activity-2', 110, 'error', 'Fetch second source'),
      activityEntry('activity-3', 120, 'success', 'Fetch third source'),
    ]);
    await Promise.resolve();

    const updatedPhase = root.querySelector('details[data-flower-subagent-ledger-kind="activity"]') as HTMLDetailsElement;
    expect(updatedPhase.textContent).toContain('3 operations');
    expect(updatedPhase.getAttribute('data-flower-subagent-activity-status')).toBe('error');
    expect(updatedPhase.open).toBe(false);
  });
});
