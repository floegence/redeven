// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActivityTimelineBlock } from './ActivityTimelineBlock';
import type { ActivityItem, ActivityTimelineBlock as ActivityTimelineBlockType } from '../types';

const approveToolCallMock = vi.hoisted(() => vi.fn());
const fetchGatewayJSONMock = vi.hoisted(() => vi.fn());
const writeTextToClipboardMock = vi.hoisted(() => vi.fn());

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...classes: Array<string | undefined | null | false>) => classes.filter(Boolean).join(' '),
}));

vi.mock('../ChatProvider', () => ({
  useChatContext: () => ({
    approveToolCall: approveToolCallMock,
  }),
}));

vi.mock('../../services/gatewayApi', () => ({
  fetchGatewayJSON: (...args: unknown[]) => fetchGatewayJSONMock(...args),
}));

vi.mock('../../utils/clipboard', () => ({
  writeTextToClipboard: (...args: unknown[]) => writeTextToClipboardMock(...args),
}));

const renderDisposers: Array<() => void> = [];

function baseSummary(
  status: ActivityTimelineBlockType['summary']['status'] = 'success',
  totalItems = 1,
): ActivityTimelineBlockType['summary'] {
  const counts: ActivityTimelineBlockType['summary']['counts'] = {};
  if (status === 'pending') counts.pending = totalItems;
  if (status === 'running') counts.running = totalItems;
  if (status === 'waiting') counts.waiting = totalItems;
  if (status === 'success') counts.success = totalItems;
  if (status === 'error') counts.error = totalItems;
  if (status === 'canceled') counts.canceled = totalItems;
  return {
    status,
    severity: status === 'success' ? 'quiet' : status === 'error' ? 'error' : 'blocking',
    needs_attention: status !== 'success',
    total_items: totalItems,
    counts,
  };
}

function baseItem(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    item_id: 'tool_1',
    tool_id: 'tool_1',
    tool_name: 'terminal.exec',
    kind: 'tool',
    renderer: 'terminal',
    status: 'success',
    severity: 'quiet',
    needs_attention: false,
    requires_approval: false,
    label: 'go test ./...',
    description: 'Run tests',
    detail_refs: [{
      ref_id: 'terminal:tool_1',
      kind: 'terminal',
      tool_id: 'tool_1',
      fetch_mode: 'endpoint',
      endpoint: '/_redeven_proxy/api/ai/runs/run_1/tools/tool_1/output',
      title: 'Command output',
    }],
    ...overrides,
  };
}

function baseBlock(overrides: Partial<ActivityTimelineBlockType> = {}): ActivityTimelineBlockType {
  const items = overrides.items ?? [baseItem()];
  return {
    type: 'activity-timeline',
    schema_version: 1,
    run_id: 'run_1',
    turn_id: 'msg_1',
    summary: overrides.summary ?? baseSummary('success', items.length),
    items,
    ...overrides,
  };
}

function renderActivity(block: ActivityTimelineBlockType = baseBlock()) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => <ActivityTimelineBlock block={block} messageId="msg_1" blockIndex={0} />, host);
  renderDisposers.push(dispose);
  return host;
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function expandTimeline(host: HTMLElement): void {
  const summary = host.querySelector('.chat-activity-timeline-summary') as HTMLButtonElement | null;
  summary?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

afterEach(() => {
  while (renderDisposers.length > 0) {
    renderDisposers.pop()?.();
  }
  approveToolCallMock.mockReset();
  fetchGatewayJSONMock.mockReset();
  writeTextToClipboardMock.mockReset();
  document.body.innerHTML = '';
});

describe('ActivityTimelineBlock', () => {
  it('keeps activity compact and opens terminal details from the item row', async () => {
    fetchGatewayJSONMock.mockResolvedValue({
      status: 'success',
      stdout: 'ok\n',
      stderr: '',
      exit_code: 0,
      duration_ms: 8,
      cwd: '/tmp',
    });
    writeTextToClipboardMock.mockResolvedValue(undefined);
    const host = renderActivity();

    expect(host.textContent).toContain('go test ./...');

    expandTimeline(host);
    await flushAsync();

    expect(host.textContent).toContain('go test ./...');
    expect(host.textContent).not.toContain('Details');
    expect(host.querySelector('.chat-activity-item-label')).not.toBeNull();

    const row = host.querySelector('.chat-activity-item-clickable') as HTMLDivElement | null;
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(fetchGatewayJSONMock).toHaveBeenCalledWith('/_redeven_proxy/api/ai/runs/run_1/tools/tool_1/output', { method: 'GET' });
    expect(host.textContent).toContain('Command output');
    expect(host.textContent).toContain('Working directory');
    expect(host.textContent).toContain('/tmp');
    expect(host.textContent).toContain('stdout');
    expect(host.textContent).toContain('ok');

    const copyButton = [...host.querySelectorAll('.chat-activity-detail-action')]
      .find((button) => button.textContent === 'Copy stdout') as HTMLButtonElement | undefined;
    copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(writeTextToClipboardMock).toHaveBeenCalledWith('ok\n');
    expect(copyButton?.textContent).toBe('Copied');
  });

  it('supports keyboard expansion and opens rows without explicit detail refs', async () => {
    fetchGatewayJSONMock.mockResolvedValue({ stdout: 'ok\n', stderr: '' });
    const host = renderActivity();
    expandTimeline(host);
    await flushAsync();

    const row = host.querySelector('.chat-activity-item-clickable') as HTMLDivElement | null;
    row?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flushAsync();

    expect(row?.getAttribute('aria-expanded')).toBe('true');
    expect(fetchGatewayJSONMock).toHaveBeenCalledTimes(1);

    row?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await flushAsync();

    expect(row?.getAttribute('aria-expanded')).toBe('false');

    const noDetailHost = renderActivity(baseBlock({
      summary: baseSummary('success'),
      items: [baseItem({
        item_id: 'tool_no_detail',
        tool_id: 'tool_no_detail',
        description: 'pwd',
        detail_refs: undefined,
      })],
    }));
    expandTimeline(noDetailHost);
    const noDetailRow = noDetailHost.querySelector('.chat-activity-item') as HTMLDivElement | null;
    noDetailRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(noDetailRow?.getAttribute('role')).toBe('button');
    expect(noDetailRow?.getAttribute('aria-expanded')).toBe('true');
    expect(noDetailHost.querySelector('.chat-activity-detail-panel')).not.toBeNull();
  });

  it('opens structured activity payloads without detail refs', async () => {
    const host = renderActivity(baseBlock({
      items: [baseItem({
        detail_refs: undefined,
        renderer: 'terminal',
        label: 'npm run build -- --mode production',
        payload: {
          command: 'npm run build -- --mode production',
          cwd: '/workspace/redeven',
          stdout: 'built\n',
          stderr: '',
          exit_code: 0,
          duration_ms: 42,
          truncated: false,
        },
      })],
    }));
    expandTimeline(host);
    await flushAsync();

    const row = host.querySelector('.chat-activity-item-clickable') as HTMLDivElement | null;
    expect(row).not.toBeNull();
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(fetchGatewayJSONMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain('npm run build -- --mode production');
    expect(host.textContent).toContain('/workspace/redeven');
    expect(host.textContent).toContain('built');
  });

  it('uses inline detail payloads without making an endpoint request', async () => {
    const host = renderActivity(baseBlock({
      items: [baseItem({
        item_id: 'tool_inline',
        tool_id: 'tool_inline',
        description: 'pwd',
        detail_refs: [{
          ref_id: 'terminal:tool_inline',
          kind: 'terminal',
          tool_id: 'tool_inline',
          fetch_mode: 'inline',
          title: 'Command output',
          payload: { stdout: '/workspace\n', exit_code: 0 },
        }],
      })],
    }));
    expandTimeline(host);

    const row = host.querySelector('.chat-activity-item-clickable') as HTMLDivElement | null;
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(fetchGatewayJSONMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain('/workspace');
    expect(host.textContent).toContain('Exit');
  });

  it('does not expand a detail row while text is selected', async () => {
    const originalGetSelection = window.getSelection;
    Object.defineProperty(window, 'getSelection', {
      configurable: true,
      value: () => ({ toString: () => 'selected output text' }),
    });
    try {
      const host = renderActivity();
      expandTimeline(host);

      const row = host.querySelector('.chat-activity-item-clickable') as HTMLDivElement | null;
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushAsync();

      expect(fetchGatewayJSONMock).not.toHaveBeenCalled();
      expect(row?.getAttribute('aria-expanded')).toBe('false');
      expect(host.querySelector('.chat-activity-detail-panel')).toBeNull();
    } finally {
      Object.defineProperty(window, 'getSelection', {
        configurable: true,
        value: originalGetSelection,
      });
    }
  });

  it('routes approval actions through the chat context', () => {
    const block = baseBlock({
      summary: baseSummary('waiting'),
      items: [baseItem({
        item_id: 'tool_patch',
        tool_id: 'tool_patch',
        tool_name: 'apply_patch',
        renderer: 'patch',
        status: 'waiting',
        severity: 'blocking',
        needs_attention: true,
        label: 'Applied patch',
        requires_approval: true,
        approval_state: 'requested',
        detail_refs: [{
          ref_id: 'tool_detail:tool_patch',
          kind: 'tool_detail',
          tool_id: 'tool_patch',
          fetch_mode: 'endpoint',
          endpoint: '/_redeven_proxy/api/ai/runs/run_1/tools/tool_patch/detail',
          title: 'Tool detail',
        }],
      })],
    });
    const host = renderActivity(block);

    const allow = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Allow') as HTMLButtonElement | undefined;
    allow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(approveToolCallMock).toHaveBeenCalledWith('msg_1', 'tool_patch', true);
    expect(fetchGatewayJSONMock).not.toHaveBeenCalled();
    expect(host.querySelector('.chat-activity-detail-panel')).toBeNull();
  });

  it('renders todo details as structured status rows', async () => {
    fetchGatewayJSONMock.mockResolvedValue({
      tool_name: 'write_todos',
      status: 'success',
      result: {
        todos: [
          { id: 't1', content: 'Inspect current implementation', status: 'completed' },
          { id: 't2', content: 'Draft renderer contract', status: 'in_progress' },
        ],
      },
    });
    const host = renderActivity(baseBlock({
      items: [baseItem({
        item_id: 'tool_todos',
        tool_id: 'tool_todos',
        tool_name: 'write_todos',
        renderer: 'todos',
        label: 'Updated todos',
        detail_refs: [{
          ref_id: 'tool_detail:tool_todos',
          kind: 'tool_detail',
          tool_id: 'tool_todos',
          fetch_mode: 'endpoint',
          endpoint: '/_redeven_proxy/api/ai/runs/run_1/tools/tool_todos/detail',
          title: 'Tool detail',
        }],
      })],
    }));
    expandTimeline(host);

    const row = host.querySelector('.chat-activity-item-clickable') as HTMLDivElement | null;
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(host.textContent).toContain('Todo changes');
    expect(host.textContent).toContain('Inspect current implementation');
    expect(host.textContent).toContain('In progress');
    expect(host.textContent).not.toContain('"todos"');
  });

  it('copies localized fallback text for untitled todo summaries', async () => {
    fetchGatewayJSONMock.mockResolvedValue({
      tool_name: 'write_todos',
      status: 'success',
      result: {
        todos: [
          { id: 't1', status: 'pending' },
        ],
      },
    });
    const host = renderActivity(baseBlock({
      items: [baseItem({
        item_id: 'tool_todos',
        tool_id: 'tool_todos',
        tool_name: 'write_todos',
        renderer: 'todos',
        label: 'Updated todos',
        detail_refs: [{
          ref_id: 'tool_detail:tool_todos',
          kind: 'tool_detail',
          tool_id: 'tool_todos',
          fetch_mode: 'endpoint',
          endpoint: '/_redeven_proxy/api/ai/runs/run_1/tools/tool_todos/detail',
          title: 'Tool detail',
        }],
      })],
    }));
    expandTimeline(host);

    const row = host.querySelector('.chat-activity-item-clickable') as HTMLDivElement | null;
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    const copyButton = [...host.querySelectorAll('.chat-activity-detail-action')]
      .find((button) => button.textContent === 'Copy summary') as HTMLButtonElement | undefined;
    copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(host.textContent).toContain('Untitled todo');
    expect(writeTextToClipboardMock).toHaveBeenCalledWith('pending: Untitled todo');
  });

  it('renders file, web, and generic tool details without exposing raw JSON', async () => {
    const block = baseBlock({
      summary: baseSummary('success', 3),
      items: [
        baseItem({
          item_id: 'tool_patch',
          tool_id: 'tool_patch',
          tool_name: 'apply_patch',
          renderer: 'patch',
          label: 'Applied patch',
          detail_refs: [{
            ref_id: 'tool_detail:tool_patch',
            kind: 'tool_detail',
            tool_id: 'tool_patch',
            fetch_mode: 'endpoint',
            endpoint: '/patch',
            title: 'Tool detail',
          }],
        }),
        baseItem({
          item_id: 'tool_web',
          tool_id: 'tool_web',
          tool_name: 'web.search',
          renderer: 'web_search',
          label: 'Searched the web',
          detail_refs: [{
            ref_id: 'tool_detail:tool_web',
            kind: 'tool_detail',
            tool_id: 'tool_web',
            fetch_mode: 'endpoint',
            endpoint: '/web',
            title: 'Tool detail',
          }],
        }),
        baseItem({
          item_id: 'tool_skill',
          tool_id: 'tool_skill',
          tool_name: 'use_skill',
          renderer: 'structured',
          label: 'Loaded skill',
          detail_refs: [{
            ref_id: 'tool_detail:tool_skill',
            kind: 'tool_detail',
            tool_id: 'tool_skill',
            fetch_mode: 'endpoint',
            endpoint: '/skill',
            title: 'Tool detail',
          }],
        }),
      ],
    });
    fetchGatewayJSONMock.mockImplementation((endpoint: string) => {
      if (endpoint === '/patch') {
        return Promise.resolve({
          tool_name: 'apply_patch',
          status: 'success',
          args: { patch: '*** Begin Patch\n*** Update File: src/ui/chat/activity/ActivityDetailPanel.tsx\n@@\n+panel\n*** End Patch' },
        });
      }
      if (endpoint === '/web') {
        return Promise.resolve({
          tool_name: 'web.search',
          status: 'success',
          args: { query: 'active agent UI tool details' },
          result: { sources: [{ title: 'Agent UI', url: 'https://example.com/agent-ui', snippet: 'Expandable tool calls.' }] },
        });
      }
      return Promise.resolve({
        tool_name: 'use_skill',
        status: 'success',
        args: { name: 'frontend-design', api_key: 'sk-secret', value: 'inline-secret', contains_secret: true },
        result: { loaded: true, metadata: { origin: 'local' } },
      });
    });
    const host = renderActivity(block);
    expandTimeline(host);
    const rows = [...host.querySelectorAll('.chat-activity-item-clickable')] as HTMLDivElement[];

    rows[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    rows[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    rows[2]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(host.textContent).toContain('ActivityDetailPanel.tsx');
    expect(host.textContent).toContain('active agent UI tool details');
    expect(host.textContent).toContain('Agent UI');
    expect(host.textContent).toContain('Name');
    expect(host.textContent).toContain('frontend-design');
    expect(host.textContent).toContain('Api Key');
    expect(host.textContent).toContain('********');
    expect(host.textContent).not.toContain('sk-secret');
    expect(host.textContent).not.toContain('inline-secret');
    expect(host.textContent).not.toContain('Contains Secret');
    expect(host.textContent).not.toContain('"api_key"');
  });

  it('shows a product error state and retry action when detail loading fails', async () => {
    fetchGatewayJSONMock.mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce({ stdout: 'ok\n' });
    const host = renderActivity(baseBlock({
      summary: baseSummary('error'),
      items: [baseItem({
        status: 'error',
        severity: 'error',
        needs_attention: true,
        label: 'npm test',
        detail_refs: [{
          ref_id: 'terminal:tool_1',
          kind: 'terminal',
          tool_id: 'tool_1',
          fetch_mode: 'endpoint',
          endpoint: '/output',
          title: 'Command output',
        }],
      })],
    }));

    const row = host.querySelector('.chat-activity-item-clickable') as HTMLDivElement | null;
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(host.textContent).toContain('Detail unavailable');
    expect(host.textContent).toContain('network down');

    const retry = [...host.querySelectorAll('.chat-activity-detail-action')]
      .find((button) => button.textContent === 'Retry') as HTMLButtonElement | undefined;
    retry?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(fetchGatewayJSONMock).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('stdout');
    expect(host.textContent).toContain('ok');
  });

  it('renders waiting ask_user activity as readonly status without local controls', () => {
    const block = baseBlock({
      summary: baseSummary('waiting'),
      items: [baseItem({
        item_id: 'tool_ask',
        tool_id: 'tool_ask',
        tool_name: 'ask_user',
        renderer: 'question',
        status: 'waiting',
        severity: 'blocking',
        needs_attention: true,
        label: 'Input requested',
        detail_refs: undefined,
        payload: {
          questions: [{
            id: 'q1',
            header: 'Need input',
            question: 'Choose next step',
            response_mode: 'write',
          }],
        },
      })],
    });
    const host = renderActivity(block);

    expect(host.textContent).toContain('Choose next step');
    const audit = host.querySelector('.chat-activity-user-input-audit');
    expect(audit).not.toBeNull();
    expect(audit?.querySelectorAll('input, textarea, button')).toHaveLength(0);
  });
});
