// @vitest-environment jsdom

import { Show, createSignal, type Accessor, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
});

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
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

function instructionEntry(key: string, timestamp: number, content: string): FlowerTimelineEntry {
  return {
    type: 'message',
    key,
    message: { id: key, turn_id: key, role: 'user', content, status: 'complete', created_at_ms: timestamp },
    blocks: [{ type: 'content', key: `${key}:content`, block_index: 0, block_type: 'markdown', content }],
  };
}

function renderEntry(entry: Accessor<FlowerTimelineEntry>) {
  const message = () => entry().type === 'message' ? entry() as Extract<FlowerTimelineEntry, { type: 'message' }> : null;
  const activityItem = () => message()?.blocks.flatMap((block) => block.type === 'activity' ? block.block.items : [])[0] ?? null;
  return (
    <Show when={activityItem()} fallback={<p>{message()?.message.content ?? ''}</p>}>
      {(item) => <button type="button" data-test-tool={item().item_id}>{item().label}</button>}
    </Show>
  );
}

function windowProps(entries: readonly FlowerTimelineEntry[]): SubagentDetailWindowProps {
  return {
    open: true,
    onOpenChange: () => undefined,
    threadID: 'thread-child-test',
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
    onWheel: () => undefined,
    onPointerDown: () => undefined,
    onTouchMove: () => undefined,
    showScrollToLatest: false,
    onScrollToLatest: () => undefined,
    onRetryLoad: () => undefined,
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
    const props = windowProps([]);
    disposers.push(render(() => <SubagentDetailWindow {...props} entries={entries()} />, root));

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

  it('keeps ledger and activity DOM owners stable when live entries are replaced', async () => {
    const [entries, setEntries] = createSignal<readonly FlowerTimelineEntry[]>([
      narrativeEntry('analysis-1', 100, 'Initial analysis.'),
      activityEntry('activity-1', 110, 'running', 'Fetch source'),
      activityEntry('activity-2', 120, 'running', 'Read source'),
    ]);
    const root = document.createElement('div');
    document.body.append(root);
    const props = windowProps([]);
    disposers.push(render(() => <SubagentDetailWindow {...props} entries={entries()} />, root));

    const initialNarrative = root.querySelector('[data-flower-subagent-ledger-kind="analysis"]');
    const initialBatch = root.querySelector('[data-flower-subagent-ledger-kind="activity"]');

    setEntries([
      narrativeEntry('analysis-1', 100, 'Updated analysis.'),
      activityEntry('activity-1', 110, 'running', 'Fetch source update'),
      activityEntry('activity-2', 120, 'success', 'Read source'),
    ]);
    await Promise.resolve();

    expect(root.textContent).toContain('Updated analysis.');
    expect(root.textContent).toContain('Fetch source update');
    expect(root.querySelector('[data-flower-subagent-ledger-kind="analysis"]')).toBe(initialNarrative);
    expect(root.querySelector('[data-flower-subagent-ledger-kind="activity"]')).toBe(initialBatch);
  });

  it('disposes a removed semantic key and mounts a new owner for a new key', async () => {
    const [entries, setEntries] = createSignal<readonly FlowerTimelineEntry[]>([
      narrativeEntry('analysis-1', 100, 'Initial analysis.'),
    ]);
    const root = document.createElement('div');
    document.body.append(root);
    const props = windowProps([]);
    disposers.push(render(() => <SubagentDetailWindow {...props} entries={entries()} />, root));

    const initialNarrative = root.querySelector('[data-flower-subagent-ledger-kind="analysis"]');
    setEntries([narrativeEntry('analysis-2', 200, 'Replacement analysis.')]);
    await Promise.resolve();

    const replacementNarrative = root.querySelector('[data-flower-subagent-ledger-kind="analysis"]');
    expect(initialNarrative?.isConnected).toBe(false);
    expect(replacementNarrative).not.toBe(initialNarrative);
    expect(replacementNarrative?.textContent).toContain('Replacement analysis.');
  });

  it('keeps the first tool owner stable when a single-operation phase becomes a batch', async () => {
    const [entries, setEntries] = createSignal<readonly FlowerTimelineEntry[]>([
      activityEntry('activity-1', 110, 'running', 'Fetch source'),
    ]);
    const root = document.createElement('div');
    document.body.append(root);
    const props = windowProps([]);
    disposers.push(render(() => <SubagentDetailWindow {...props} entries={entries()} />, root));

    const initialPhase = root.querySelector('[data-flower-subagent-ledger-kind="activity"]');
    const initialTool = root.querySelector('[data-test-tool="activity-1-item"]');
    expect(initialPhase?.hasAttribute('data-flower-subagent-single-operation')).toBe(true);

    setEntries([
      activityEntry('activity-1', 110, 'running', 'Fetch source update'),
      activityEntry('activity-2', 120, 'running', 'Read source'),
    ]);
    await Promise.resolve();

    const updatedPhase = root.querySelector('[data-flower-subagent-ledger-kind="activity"]');
    expect(updatedPhase).toBe(initialPhase);
    expect(updatedPhase?.hasAttribute('data-flower-subagent-single-operation')).toBe(false);
    expect(updatedPhase?.textContent).toContain('2 operations');
    expect(root.querySelector('[data-test-tool="activity-1-item"]')).toBe(initialTool);
  });

  it('preserves an entry disclosure choice while its live content changes', async () => {
    const [entries, setEntries] = createSignal<readonly FlowerTimelineEntry[]>([
      instructionEntry('instruction-1', 100, 'Initial instruction.'),
    ]);
    const root = document.createElement('div');
    document.body.append(root);
    const props = windowProps([]);
    disposers.push(render(() => <SubagentDetailWindow {...props} entries={entries()} />, root));

    const instruction = root.querySelector('details[data-flower-subagent-ledger-kind="instruction"]') as HTMLDetailsElement;
    expect(instruction.open).toBe(false);
    instruction.open = true;
    instruction.dispatchEvent(new Event('toggle'));

    setEntries([instructionEntry('instruction-1', 100, 'Updated instruction.')]);
    await Promise.resolve();

    const updatedInstruction = root.querySelector('details[data-flower-subagent-ledger-kind="instruction"]') as HTMLDetailsElement;
    expect(updatedInstruction).toBe(instruction);
    expect(updatedInstruction.open).toBe(true);
    expect(updatedInstruction.textContent).toContain('Updated instruction.');
  });
});
