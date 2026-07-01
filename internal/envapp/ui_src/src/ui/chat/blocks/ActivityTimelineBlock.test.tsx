// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActivityTimelineBlock } from './ActivityTimelineBlock';
import type { ActivityItem, ActivityTimelineBlock as ActivityTimelineBlockType } from '../types';

const approveToolCallMock = vi.hoisted(() => vi.fn());

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...classes: Array<string | undefined | null | false>) => classes.filter(Boolean).join(' '),
}));

vi.mock('../ChatProvider', () => ({
  useChatContext: () => ({
    approveToolCall: approveToolCallMock,
  }),
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
    payload: {
      command: 'go test ./...',
      stdout: 'ok\n',
      stderr: '',
      exit_code: 0,
      duration_ms: 8,
    },
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

function renderActivityWithFileActions(
  block: ActivityTimelineBlockType,
  handlers: Pick<Parameters<typeof ActivityTimelineBlock>[0], 'onPreviewFile' | 'onBrowseDirectory'>,
) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => (
    <ActivityTimelineBlock
      block={block}
      messageId="msg_1"
      blockIndex={0}
      onPreviewFile={handlers.onPreviewFile}
      onBrowseDirectory={handlers.onBrowseDirectory}
    />
  ), host);
  renderDisposers.push(dispose);
  return host;
}

function renderActivityWithSubagentMessages(
  block: ActivityTimelineBlockType,
  onOpenSubagentMessages?: Parameters<typeof ActivityTimelineBlock>[0]['onOpenSubagentMessages'],
) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => (
    <ActivityTimelineBlock
      block={block}
      messageId="msg_1"
      blockIndex={0}
      onOpenSubagentMessages={onOpenSubagentMessages}
    />
  ), host);
  renderDisposers.push(dispose);
  return host;
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitMs(ms: number): Promise<void> {
  await new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
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
  document.body.innerHTML = '';
});

describe('ActivityTimelineBlock', () => {
  it('keeps activity compact and expands terminal details from the item row', async () => {
    const host = renderActivity();

    expect(host.textContent).toContain('go test ./...');
    expect(host.textContent).not.toContain('/workspace/redeven');
    expect(host.textContent).not.toContain('stdout');

    expandTimeline(host);
    await flushAsync();

    const row = host.querySelector('.chat-activity-item-clickable') as HTMLDivElement | null;
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(row?.getAttribute('aria-expanded')).toBe('true');
    expect(host.textContent).toContain('stdout');
    expect(host.textContent).toContain('ok');
    expect(host.textContent).toContain('exit');
  });

  it('keeps detail content mounted during disclosure close animation', async () => {
    const host = renderActivity();

    expandTimeline(host);
    await flushAsync();

    const shell = host.querySelector('.chat-activity-item-shell') as HTMLDivElement | null;
    const row = host.querySelector('.chat-activity-item-clickable') as HTMLDivElement | null;
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(['opening', 'open']).toContain(shell?.getAttribute('data-state'));
    expect(host.querySelector('.chat-activity-detail-panel')).not.toBeNull();

    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(shell?.getAttribute('data-state')).toBe('closing');
    expect(host.querySelector('.chat-activity-detail-panel')).not.toBeNull();

    await waitMs(220);

    expect(shell?.getAttribute('data-state')).toBe('closed');
    expect(host.querySelector('.chat-activity-detail-panel')).toBeNull();
  });

  it('supports keyboard expansion without endpoint detail refs', async () => {
    const host = renderActivity();
    expandTimeline(host);
    await flushAsync();

    const row = host.querySelector('.chat-activity-item-clickable') as HTMLDivElement | null;
    row?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flushAsync();

    expect(row?.getAttribute('aria-expanded')).toBe('true');

    row?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await flushAsync();

    expect(row?.getAttribute('aria-expanded')).toBe('false');
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
        payload: {
          operation: 'apply_patch',
          mutations: [{
            display_name: 'src/app.ts',
            change_type: 'update',
            unified_diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,1 @@\n-old\n+new',
          }],
        },
      })],
    });
    const host = renderActivity(block);

    const allow = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Allow') as HTMLButtonElement | undefined;
    allow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(approveToolCallMock).toHaveBeenCalledWith('msg_1', 'tool_patch', true);
    expect(host.textContent).toContain('-old');
  });

  it('renders todo details as checklist rows without raw JSON', async () => {
    const host = renderActivity(baseBlock({
      items: [baseItem({
        item_id: 'tool_todos',
        tool_id: 'tool_todos',
        tool_name: 'write_todos',
        renderer: 'todos',
        label: 'Updated todos',
        payload: {
          todos: [
            { id: 't1', content: 'Inspect current implementation', status: 'completed' },
            { id: 't2', content: 'Draft renderer contract', status: 'in_progress' },
          ],
        },
      })],
    }));
    expandTimeline(host);

    const row = host.querySelector('.chat-activity-item-clickable') as HTMLDivElement | null;
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(host.textContent).toContain('Inspect current implementation');
    expect(host.textContent).toContain('in progress');
    expect(host.textContent).not.toContain('"todos"');
  });

  it('renders file, web, and generic details without exposing raw JSON', async () => {
    const block = baseBlock({
      summary: baseSummary('success', 3),
      file_actions: {
        patch_app: {
          action_id: 'patch_app',
          display_name: 'ActivityTimelineBlock.tsx',
          can_preview: true,
          can_browse_directory: true,
        },
      },
      items: [
        baseItem({
          item_id: 'tool_patch',
          tool_id: 'tool_patch',
          tool_name: 'apply_patch',
          renderer: 'patch',
          label: 'Applied patch',
          payload: {
            operation: 'apply_patch',
            mutations: [{
              display_name: 'ActivityTimelineBlock.tsx',
              file_action_id: 'patch_app',
              change_type: 'update',
              additions: 1,
              deletions: 0,
              unified_diff: '--- a/ActivityTimelineBlock.tsx\n+++ b/ActivityTimelineBlock.tsx\n@@ -1,1 +1,1 @@\n+panel',
            }],
          },
        }),
        baseItem({
          item_id: 'tool_web',
          tool_id: 'tool_web',
          tool_name: 'web.search',
          renderer: 'web_search',
          label: 'Searched the web',
          payload: { query: 'active agent UI tool details', sources: [{ title: 'Agent UI', url: 'https://example.com' }] },
        }),
        baseItem({
          item_id: 'tool_skill',
          tool_id: 'tool_skill',
          tool_name: 'use_skill',
          renderer: 'structured',
          label: 'Loaded skill',
          payload: { summary: 'frontend-design', details: 'loaded locally', status: 'success' },
        }),
      ],
    });
    const host = renderActivity(block);
    expandTimeline(host);
    const rows = [...host.querySelectorAll('.chat-activity-item-clickable')] as HTMLDivElement[];

    rows[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    rows[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    rows[2]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(host.textContent).toContain('ActivityTimelineBlock.tsx');
    expect(host.textContent).toContain('+panel');
    expect(host.textContent).toContain('active agent UI tool details');
    expect(host.textContent).toContain('Agent UI');
    expect(host.textContent).toContain('frontend-design');
    expect(host.textContent).not.toContain('"file_action_id"');
    expect(host.textContent).not.toContain('"sources"');
  });

  it('shows icon-only file actions and routes them without toggling the row', async () => {
    const preview = vi.fn();
    const browse = vi.fn();
    const block = baseBlock({
      file_actions: {
        read_app: {
          action_id: 'read_app',
          display_name: 'app.ts',
          can_preview: true,
          can_browse_directory: true,
        },
      },
      items: [baseItem({
        item_id: 'tool_read',
        tool_id: 'tool_read',
        tool_name: 'file.read',
        renderer: 'file',
        label: 'app.ts#dcbdf9b8c27f#e1703606242a',
        payload: {
          operation: 'read',
          display_name: 'app.ts',
          file_action_id: 'read_app',
          content: 'export const value = 1;\n',
          line_offset: 1,
          line_count: 1,
          total_lines: 1,
        },
      })],
    });
    const host = renderActivityWithFileActions(block, {
      onPreviewFile: preview,
      onBrowseDirectory: browse,
    });
    expandTimeline(host);
    await flushAsync();

    expect(host.textContent).toContain('Read');
    expect(host.textContent).toContain('app.ts');
    expect(host.textContent).not.toContain('#dcbdf9b8c27f');

    const row = host.querySelector('.chat-activity-item-clickable') as HTMLDivElement | null;
    const previewButton = host.querySelector('button[aria-label="Preview app.ts"]') as HTMLButtonElement | null;
    const browseButton = host.querySelector('button[aria-label="Browse folder for app.ts"]') as HTMLButtonElement | null;
    expect(previewButton).not.toBeNull();
    expect(browseButton).not.toBeNull();
    expect(previewButton?.textContent).toBe('');
    expect(browseButton?.textContent).toBe('');
    expect(previewButton?.disabled).toBe(false);
    expect(browseButton?.disabled).toBe(false);

    previewButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    browseButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(preview).toHaveBeenCalledWith(expect.objectContaining({
      action_id: 'read_app',
      can_preview: true,
    }), expect.objectContaining({ item_id: 'tool_read' }));
    expect(browse).toHaveBeenCalledWith(expect.objectContaining({
      action_id: 'read_app',
      can_browse_directory: true,
    }), expect.objectContaining({ item_id: 'tool_read' }));
    expect(row?.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps multi-file row actions visible but disabled while per-file details can open files', async () => {
    const preview = vi.fn();
    const browse = vi.fn();
    const block = baseBlock({
      file_actions: {
        edit_app: {
          action_id: 'edit_app',
          display_name: 'app.ts',
          can_preview: true,
          can_browse_directory: true,
        },
        delete_old: {
          action_id: 'delete_old',
          display_name: 'old.ts',
          can_preview: false,
          can_browse_directory: true,
        },
      },
      items: [baseItem({
        item_id: 'tool_patch',
        tool_id: 'tool_patch',
        tool_name: 'apply_patch',
        renderer: 'patch',
        label: 'Applied patch',
        payload: {
          operation: 'apply_patch',
          mutations: [
            {
              display_name: 'app.ts',
              file_action_id: 'edit_app',
              change_type: 'update',
              additions: 1,
              deletions: 1,
              unified_diff: '--- a/app.ts\n+++ b/app.ts\n@@ -1,1 +1,1 @@\n-old\n+new',
            },
            {
              display_name: 'old.ts',
              file_action_id: 'delete_old',
              change_type: 'delete',
              deletions: 1,
              unified_diff: '--- a/old.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-remove',
            },
          ],
        },
      })],
    });
    const host = renderActivityWithFileActions(block, {
      onPreviewFile: preview,
      onBrowseDirectory: browse,
    });
    expandTimeline(host);
    await flushAsync();

    const rowPreview = host.querySelector('button[aria-label="Preview 2 files"]') as HTMLButtonElement | null;
    const rowBrowse = host.querySelector('button[aria-label="Browse folder for 2 files"]') as HTMLButtonElement | null;
    expect(rowPreview?.disabled).toBe(true);
    expect(rowBrowse?.disabled).toBe(true);

    const row = host.querySelector('.chat-activity-item-clickable') as HTMLDivElement | null;
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    const appPreview = host.querySelector('button[aria-label="Preview app.ts"]') as HTMLButtonElement | null;
    const appBrowse = host.querySelector('button[aria-label="Browse folder for app.ts"]') as HTMLButtonElement | null;
    const oldPreview = host.querySelector('button[aria-label="Preview old.ts"]') as HTMLButtonElement | null;
    const oldBrowse = host.querySelector('button[aria-label="Browse folder for old.ts"]') as HTMLButtonElement | null;
    expect(appPreview?.disabled).toBe(false);
    expect(appBrowse?.disabled).toBe(false);
    expect(oldPreview?.disabled).toBe(true);
    expect(oldBrowse?.disabled).toBe(false);

    appPreview?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    oldBrowse?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ action_id: 'edit_app' }), expect.objectContaining({ item_id: 'tool_patch' }));
    expect(browse).toHaveBeenCalledWith(expect.objectContaining({ action_id: 'delete_old' }), expect.objectContaining({ item_id: 'tool_patch' }));
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

  it('renders subagent wait rows with message entry and no diagnostic fields', async () => {
    const openMessages = vi.fn();
    const now = Date.now();
    const block = baseBlock({
      summary: baseSummary('success'),
      items: [baseItem({
        item_id: 'tool_subagents_wait',
        tool_id: 'tool_subagents_wait',
        tool_name: 'subagents',
        renderer: 'structured',
        label: 'subagents',
        payload: {
          action: 'wait',
          status: 'ok',
          summary: 'tool execution completed',
        },
      })],
      subagent_actions: {
        tool_subagents_wait: {
          operation: 'subagents',
          action: 'wait',
          delegation_runtime: 'floret',
          items: [{
            thread_id: 'child_frontend_review',
            subagent_id: 'child_frontend_review',
            title: 'Frontend polish review',
            task_name: 'Frontend polish review',
            task_description: 'Review Flower tool detail UI and propose concise fixes.',
            agent_type: 'worker',
            status: 'running',
            started_at_ms: now - 258000,
            updated_at_ms: now - 1000,
          }],
        },
      },
    });
    const host = renderActivityWithSubagentMessages(block, openMessages);

    expandTimeline(host);
    await flushAsync();

    expect(host.textContent).toContain('Waiting');
    expect(host.textContent).toContain('Frontend polish review');
    expect(host.textContent).toContain('running');

    const row = host.querySelector('.chat-activity-item-clickable') as HTMLDivElement | null;
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(host.textContent).toContain('Review Flower tool detail UI and propose concise fixes.');
    expect(host.textContent).toContain('Open messages');
    for (const hidden of ['Worker', 'action wait', 'status success', 'agents count', 'thread_id', 'subagent_id', 'tool execution completed']) {
      expect(host.textContent).not.toContain(hidden);
    }

    const button = [...host.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Open messages') as HTMLButtonElement | undefined;
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(openMessages).toHaveBeenCalledWith({
      threadID: 'child_frontend_review',
      subagentID: 'child_frontend_review',
      name: 'Frontend polish review',
      task: 'Review Flower tool detail UI and propose concise fixes.',
    });
  });
});
