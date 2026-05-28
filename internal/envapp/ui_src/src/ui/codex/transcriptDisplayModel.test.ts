import { describe, expect, it } from 'vitest';

import {
  buildCodexTranscriptDisplayNodes,
  type CodexTranscriptActivityGroupNode,
} from './transcriptDisplayModel';
import type { CodexTranscriptItem } from './types';

function item(partial: Partial<CodexTranscriptItem> & Pick<CodexTranscriptItem, 'id' | 'type'>): CodexTranscriptItem {
  return {
    order: 0,
    ...partial,
  };
}

function activity(nodes: ReturnType<typeof buildCodexTranscriptDisplayNodes>, index: number): CodexTranscriptActivityGroupNode {
  const node = nodes[index];
  expect(node?.kind).toBe('activity_group');
  return node as CodexTranscriptActivityGroupNode;
}

describe('buildCodexTranscriptDisplayNodes', () => {
  it('groups consecutive execution items into a compact activity group', () => {
    const nodes = buildCodexTranscriptDisplayNodes([
      item({ id: 'user-1', type: 'userMessage', text: 'Fix it', order: 1 }),
      item({
        id: 'search-1',
        type: 'webSearch',
        query: 'assistant-ui tool group',
        action: { type: 'search' },
        order: 2,
      }),
      item({
        id: 'cmd-1',
        type: 'commandExecution',
        command: 'npm test',
        exit_code: 0,
        duration_ms: 2400,
        order: 3,
      }),
      item({ id: 'assistant-1', type: 'agentMessage', text: 'Done', order: 4 }),
    ]);

    expect(nodes.map((node) => node.kind)).toEqual(['message', 'activity_group', 'message']);
    const group = activity(nodes, 1);
    expect(group.summary.searches).toBe(1);
    expect(group.summary.commands).toBe(1);
    expect(group.summary.headline).toBe('');
    expect(group.items.map((entry) => entry.label)).toEqual([
      'assistant-ui tool group',
      'npm test',
    ]);
  });

  it('does not cross user message boundaries', () => {
    const nodes = buildCodexTranscriptDisplayNodes([
      item({ id: 'cmd-1', type: 'commandExecution', command: 'npm test', order: 1 }),
      item({ id: 'user-1', type: 'userMessage', text: 'Also run lint', order: 2 }),
      item({ id: 'cmd-2', type: 'commandExecution', command: 'npm run lint', order: 3 }),
    ]);

    expect(nodes.map((node) => node.kind)).toEqual(['activity_group', 'message', 'activity_group']);
    expect(activity(nodes, 0).items[0]?.label).toBe('npm test');
    expect(activity(nodes, 2).items[0]?.label).toBe('npm run lint');
  });

  it('expands multi-file changes into clickable file diff activity items', () => {
    const nodes = buildCodexTranscriptDisplayNodes([
      item({
        id: 'changes-1',
        type: 'fileChange',
        order: 1,
        changes: [
          {
            path: 'internal/runtime/desktop_bridge.go',
            kind: 'update',
            diff: [
              'diff --git a/internal/runtime/desktop_bridge.go b/internal/runtime/desktop_bridge.go',
              '--- a/internal/runtime/desktop_bridge.go',
              '+++ b/internal/runtime/desktop_bridge.go',
              '@@ -1 +1,2 @@',
              '-old',
              '+new',
              '+line',
            ].join('\n'),
          },
          {
            path: 'internal/runtime/desktop_runtime_daemon.go',
            kind: 'new',
            diff: 'package runtime\n',
          },
        ],
      }),
    ]);

    const group = activity(nodes, 0);
    expect(group.summary.editedFiles).toBe(1);
    expect(group.summary.createdFiles).toBe(1);
    expect(group.summary.additions).toBe(3);
    expect(group.summary.deletions).toBe(1);
    expect(group.items).toHaveLength(2);
    expect(group.items[0]).toMatchObject({
      kind: 'file_change',
      label: '…/runtime/desktop_bridge.go +2 -1',
      detail: { type: 'file_diff', sourceItemID: 'changes-1', changeIndex: 0 },
    });
    expect(group.items[1]).toMatchObject({
      kind: 'file_change',
      label: '…/runtime/desktop_runtime_daemon.go +1 -0',
      detail: { type: 'file_diff', sourceItemID: 'changes-1', changeIndex: 1 },
    });
  });

  it('marks failed commands and groups as failed without rendering a heavy command block by default', () => {
    const nodes = buildCodexTranscriptDisplayNodes([
      item({
        id: 'cmd-1',
        type: 'commandExecution',
        command: 'go test ./...',
        exit_code: 1,
        status: 'failed',
        duration_ms: 18_000,
        order: 1,
      }),
    ]);

    const group = activity(nodes, 0);
    expect(group.status).toBe('failed');
    expect(group.defaultExpandLevel).toBe('semi');
    expect(group.summary.failedCommands).toBe(1);
    expect(group.items[0]).toMatchObject({
      kind: 'command',
      status: 'failed',
      label: 'go test ./...',
      detail: { type: 'command_output', sourceItemID: 'cmd-1' },
    });
  });

  it('omits empty reasoning and plan items', () => {
    const nodes = buildCodexTranscriptDisplayNodes([
      item({ id: 'reasoning-empty', type: 'reasoning', order: 1 }),
      item({ id: 'plan-empty', type: 'plan', summary: [], content: [], order: 2 }),
    ]);

    expect(nodes).toEqual([]);
  });

  it('creates activity items for non-empty reasoning and plan content', () => {
    const nodes = buildCodexTranscriptDisplayNodes([
      item({ id: 'reasoning-1', type: 'reasoning', summary: ['Need inspect files'], order: 1 }),
      item({ id: 'plan-1', type: 'plan', content: ['1. Patch UI'], order: 2 }),
    ]);

    const group = activity(nodes, 0);
    expect(group.summary.hasReasoning).toBe(true);
    expect(group.summary.hasPlan).toBe(true);
    expect(group.items.map((entry) => entry.kind)).toEqual(['reasoning', 'plan']);
    expect(group.items.map((entry) => entry.detail.type)).toEqual(['reasoning', 'plan']);
  });

  it('renders turn diagnostics as attention rows instead of activity noise', () => {
    const nodes = buildCodexTranscriptDisplayNodes([
      item({
        id: 'turn:turn_1:diagnostic:empty_response',
        type: 'turnDiagnostic',
        turn_id: 'turn_1',
        diagnostic_kind: 'empty_response',
        status: 'empty_response',
        text: 'Codex completed this turn without a visible response.',
        order: 2,
      }),
      item({
        id: 'turn:turn_2:diagnostic:turn_error',
        type: 'turnDiagnostic',
        turn_id: 'turn_2',
        diagnostic_kind: 'turn_error',
        status: 'failed',
        text: 'Provider failed.',
        order: 3,
      }),
    ]);

    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({
      kind: 'attention',
      reason: 'empty_response',
    });
    expect(nodes[1]).toMatchObject({
      kind: 'attention',
      reason: 'error',
    });
  });
});
