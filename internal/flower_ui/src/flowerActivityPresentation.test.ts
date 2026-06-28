import { describe, expect, it } from 'vitest';

import type { FlowerActivityItem } from './contracts/flowerSurfaceContracts';
import { presentFlowerActivityItem } from './flowerActivityPresentation';

function item(overrides: Partial<FlowerActivityItem>): FlowerActivityItem {
  return {
    item_id: 'tool-1',
    tool_id: 'tool-1',
    tool_name: 'terminal.exec',
    kind: 'tool',
    status: 'success',
    severity: 'quiet',
    needs_attention: false,
    requires_approval: false,
    ...overrides,
  };
}

const fileActions = {
  read_app: {
    action_id: 'read_app',
    display_name: 'app.ts',
    can_preview: true,
    can_browse_directory: true,
  },
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
} as const;

describe('presentFlowerActivityItem', () => {
  it('uses the terminal command as the compact row label', () => {
    const presentation = presentFlowerActivityItem(item({
      renderer: 'terminal',
      status: 'running',
      label: 'npm run build -- --mode production',
      payload: {
        command: 'npm run build -- --mode production',
        cwd: '/workspace/app',
        workdir: '/workspace/private',
        exit_code: 0,
        stdout: 'built\n',
        stderr: '',
        stdin: 'secret',
      },
      chips: [{ kind: 'exit_code', label: 'exit', value: '0', tone: 'neutral' }],
    }));

    expect(presentation.label).toBe('npm run build -- --mode production');
    expect(presentation.title).toEqual({ kind: 'command', command: 'npm run build -- --mode production' });
    expect(presentation.meta).toContain('exit 0');
    expect(presentation.detailLines.map((line) => `${line.label}:${line.value}`)).toContain('command:npm run build -- --mode production');
    expect(presentation.detailLines.map((line) => `${line.label}:${line.value}`)).toContain('stdout:built');
    expect(presentation.detailLines.map((line) => line.label)).not.toContain('cwd');
    expect(presentation.detailLines.map((line) => line.label)).not.toContain('workdir');
    expect(presentation.detailLines.map((line) => line.label)).not.toContain('stdin');
  });

  it('prefers the terminal payload command over a stale generic label', () => {
    const presentation = presentFlowerActivityItem(item({
      renderer: 'terminal',
      label: 'terminal.exec',
      payload: {
        command: 'pnpm test -- src/ui/chat/activity/ActivityTimelineBlock.test.tsx',
      },
    }));

    expect(presentation.label).toBe('pnpm test -- src/ui/chat/activity/ActivityTimelineBlock.test.tsx');
  });

  it('renders terminal result status and structured error details separately', () => {
    const presentation = presentFlowerActivityItem(item({
      renderer: 'terminal',
      status: 'error',
      label: 'curl -sL https://example.test',
      payload: {
        command: 'curl -sL https://example.test',
        status: 'timeout',
        duration_ms: 30000,
        timed_out: true,
        error: {
          code: 'TIMEOUT',
          message: 'Tool execution timed out after 30000 ms',
          retryable: true,
        },
      },
    }));

    expect(presentation.detailLines.map((line) => `${line.label}:${line.value}`)).toContain('result status:timeout');
    expect(presentation.detailLines.map((line) => `${line.label}:${line.value}`)).toContain('error code:TIMEOUT');
    expect(presentation.detailLines.map((line) => `${line.label}:${line.value}`)).toContain('error message:Tool execution timed out after 30000 ms');
    expect(presentation.detailLines.map((line) => `${line.label}:${line.value}`)).toContain('retryable:true');
    expect(presentation.detailLines.map((line) => line.label)).not.toContain('error');
  });

  it('keeps payload result status as detail data when it conflicts with the item status', () => {
    const presentation = presentFlowerActivityItem(item({
      renderer: 'terminal',
      status: 'error',
      label: 'curl -sL https://example.test',
      payload: {
        command: 'curl -sL https://example.test',
        status: 'success',
        error: {
          code: 'UNKNOWN',
          message: 'The final activity item failed.',
          retryable: false,
        },
      },
    }));

    expect(presentation.detailLines.map((line) => `${line.label}:${line.value}`)).toContain('result status:success');
    expect(presentation.detailLines.map((line) => `${line.label}:${line.value}`)).toContain('error code:UNKNOWN');
    expect(presentation.meta).not.toContain('success');
  });

  it('keeps real running descriptions in compact meta text', () => {
    const presentation = presentFlowerActivityItem(item({
      renderer: 'terminal',
      status: 'running',
      description: 'Compiling the workspace',
      payload: {
        command: 'python3 fetch.py',
        duration_ms: 512,
      },
    }));

    expect(presentation.meta).toContain('512ms');
    expect(presentation.meta).toContain('Compiling the workspace');
  });

  it('keeps the generic fallback title independent from tool_name', () => {
    const presentation = presentFlowerActivityItem(item({
      renderer: 'structured',
      label: 'Resolve workspace status',
      tool_name: 'terminal.exec',
    }));

    expect(presentation.label).toBe('Resolve workspace status');
  });

  it('renders subagent tool activity as delegation instead of raw structured payload', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'subagents',
      renderer: 'structured',
      label: 'subagents',
      payload: {
        action: 'spawn',
        status: 'ok',
        snapshot: {
          thread_id: 'child-thread-1',
          subagent_id: 'child-thread-1',
          task_name: 'Review API boundary',
          agent_type: 'reviewer',
          status: 'running',
          last_message: 'Reading contracts',
          delegation_runtime: 'floret',
        },
      },
    }));

    expect(presentation.label).toBe('Spawn Review API boundary');
    expect(presentation.title).toEqual({ kind: 'plain', text: 'Spawn Review API boundary' });
    expect(presentation.meta).toContain('Spawn subagent');
    expect(presentation.meta).toContain('Running');
    expect(presentation.detailLines.map((line) => `${line.label}:${line.value}`)).toContain('thread:child-thread-1');
    expect(presentation.detailLines.map((line) => `${line.label}:${line.value}`)).toContain('profile:Reviewer');
    expect(presentation.detailLines.some((line) => line.value.includes('"snapshot"'))).toBe(false);
  });

  it('renders subagent context mode and wait handoff fields as first-class details', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'subagents',
      renderer: 'structured',
      label: 'subagents',
      payload: {
        action: 'wait',
        status: 'ok',
        items: [{
          thread_id: 'child-thread-1',
          subagent_id: 'child-thread-1',
          task_name: 'Review API boundary',
          agent_type: 'reviewer',
          context_mode: 'mission_only',
          status: 'completed',
          final_handoff_report: 'Reviewed API boundary. No blocking risks remain.',
          progress_summary: 'Should not be used for completed waits.',
        }],
      },
    }));

    const rows = presentation.detailLines.map((line) => `${line.label}:${line.value}`);
    expect(rows).toContain('context mode:mission_only');
    expect(rows).toContain('final handoff:Reviewed API boundary. No blocking risks remain.');
    expect(rows).toContain('progress summary:Should not be used for completed waits.');
    expect(rows).not.toContain('last message:Reviewed API boundary. No blocking risks remain.');
  });

  it('localizes unknown subagent status, type, and boolean detail values', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'subagents',
      renderer: 'structured',
      label: 'subagents',
      payload: {
        action: 'inspect',
        snapshot: {
          thread_id: 'child-thread-unknown',
          agent_type: 'custom-profile',
          status: 'paused_elsewhere',
          accepted: true,
          can_close: false,
          delegation_runtime: 'floret',
        },
      },
    }));

    const rows = presentation.detailLines.map((line) => `${line.label}:${line.value}`);
    expect(presentation.meta).toContain('Subagent');
    expect(presentation.meta).toContain('Unknown');
    expect(rows).toContain('profile:Subagent');
    expect(rows).toContain('result status:Unknown');
    expect(rows).toContain('accepted:Yes');
    expect(rows).toContain('can close:No');
    expect(rows.join('\n')).not.toContain('custom-profile');
    expect(rows.join('\n')).not.toContain('paused_elsewhere');
    expect(rows.join('\n')).not.toContain(':true');
    expect(rows.join('\n')).not.toContain(':false');
  });

  it('does not render legacy subagent collection fields as detail records', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'subagents',
      renderer: 'structured',
      label: 'subagents',
      payload: {
        action: 'wait',
        status: 'ok',
        snapshots: {
          legacy1: {
            thread_id: 'legacy-child-1',
            task_name: 'Legacy snapshot',
            status: 'running',
          },
        },
        snapshots_by_id: {
          legacy2: {
            thread_id: 'legacy-child-2',
            task_name: 'Legacy snapshot map',
            status: 'running',
          },
        },
        subagents: [{
          thread_id: 'legacy-child-3',
          task_name: 'Legacy subagents list',
          status: 'running',
        }],
      },
    }));

    const rows = presentation.detailLines.map((line) => `${line.label}:${line.value}`).join('\n');
    expect(presentation.label).toBe('Wait');
    expect(rows).not.toContain('legacy-child-1');
    expect(rows).not.toContain('legacy-child-2');
    expect(rows).not.toContain('legacy-child-3');
    expect(rows).not.toContain('Legacy snapshot');
    expect(rows).not.toContain('Legacy subagents list');
  });

  it('does not render unrelated nested result ids as delegation', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'web.search',
      renderer: 'structured',
      label: 'Search docs',
      payload: {
        items: [{ id: 'result-1', title: 'Search result' }],
      },
    }));

    expect(presentation.label).toBe('Web search "Search docs"');
    expect(presentation.title).toEqual({ kind: 'plain', text: 'Web search "Search docs"' });
    expect(presentation.detailLines.map((line) => line.label)).not.toContain('thread');
    expect(presentation.detailLines.map((line) => line.label)).not.toContain('profile');
  });

  it('renders web search error records as separate detail lines', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'web.search',
      renderer: 'web_search',
      status: 'error',
      label: 'latest release',
      payload: {
        query: 'latest release',
        error: {
          code: 'NETWORK',
          message: 'Search provider failed',
          retryable: true,
        },
      },
    }));

    const rows = presentation.detailLines.map((line) => `${line.label}:${line.value}`);
    expect(rows).toContain('error code:NETWORK');
    expect(rows).toContain('error message:Search provider failed');
    expect(rows).toContain('retryable:true');
    expect(presentation.detailLines.map((line) => line.label)).not.toContain('error');
  });

  it('renders todo details from structured payload', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'write_todos',
      renderer: 'todos',
      label: 'Update todos',
      payload: {
        todos: [
          { content: 'Inspect thread ordering', status: 'completed' },
          { content: 'Verify detail rows', status: 'in_progress' },
        ],
        counts: { completed: 1, in_progress: 1 },
      },
      chips: [
        { kind: 'completed', label: 'completed', value: '1' },
        { kind: 'in_progress', label: 'in_progress', value: '1' },
      ],
    }));

    expect(presentation.label).toBe('Update todos');
    expect(presentation.title).toEqual({ kind: 'plain', text: 'Update todos' });
    expect(presentation.meta).toContain('completed 1');
    expect(presentation.detailLines).toHaveLength(0);
    expect(presentation.detailBlocks).toContainEqual({
      kind: 'todos',
      items: [
        { content: 'Inspect thread ordering', status: 'completed' },
        { content: 'Verify detail rows', status: 'in_progress' },
      ],
    });
  });

  it('renders todo result status and error details without hiding the todo block', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'write_todos',
      renderer: 'todos',
      status: 'error',
      label: 'Update todos',
      payload: {
        status: 'error',
        todos: [
          { content: 'Keep final review open', status: 'in_progress' },
        ],
        error: {
          code: 'UNKNOWN',
          message: 'Todo update failed',
          retryable: false,
        },
      },
    }));

    expect(presentation.detailBlocks.map((block) => block.kind)).toEqual(['todos', 'structured']);
    expect(presentation.detailLines.map((line) => `${line.label}:${line.value}`)).toContain('result status:error');
    expect(presentation.detailLines.map((line) => `${line.label}:${line.value}`)).toContain('error code:UNKNOWN');
    expect(presentation.detailLines.map((line) => `${line.label}:${line.value}`)).toContain('error message:Todo update failed');
    expect(presentation.detailLines.map((line) => line.label)).not.toContain('error');
  });

  it('reads todo details from result payloads without exposing JSON', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'write_todos',
      renderer: 'todos',
      payload: {
        result: {
          todos: [
            { id: 'todo-1', content: 'Recheck empty activity blocks', status: 'done', note: 'verified locally' },
          ],
        },
      },
    }));

    expect(presentation.detailLines).toHaveLength(0);
    expect(presentation.detailLines.some((line) => line.value.includes('"todos"'))).toBe(false);
    expect(presentation.detailBlocks).toContainEqual({
      kind: 'todos',
      items: [
        { id: 'todo-1', content: 'Recheck empty activity blocks', status: 'completed', note: 'verified locally' },
      ],
    });
  });

  it('reads todo details from args payloads without exposing JSON', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'write_todos',
      renderer: 'todos',
      payload: {
        args: {
          todos: [
            { content: 'Validate args todo rendering', status: 'active' },
          ],
        },
      },
    }));

    expect(presentation.detailLines).toHaveLength(0);
    expect(presentation.detailLines.some((line) => line.value.includes('"todos"'))).toBe(false);
    expect(presentation.detailBlocks).toContainEqual({
      kind: 'todos',
      items: [
        { content: 'Validate args todo rendering', status: 'in_progress' },
      ],
    });
  });

  it('renders file reads as an explicit Read action with file_read details', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'file.read',
      renderer: 'file',
      label: 'app.ts#dcbdf9b8c27f#e1703606242a',
      target_refs: [{ kind: 'file', label: 'app.ts#dcbdf9b8c27f' }],
      payload: {
        operation: 'read',
        display_name: 'app.ts',
        file_action_id: 'read_app',
        content: 'const value = 1;\n',
        line_offset: 7,
        line_count: 1,
        total_lines: 42,
        truncated: false,
      },
    }), fileActions);

    expect(presentation.label).toBe('Read app.ts');
    expect(presentation.title).toEqual({ kind: 'file', verb: 'Read', display_name: 'app.ts' });
    expect(presentation.meta).not.toContain('#dcbdf9b8c27f');
    expect(presentation.primaryAction).toEqual({
      action_id: 'read_app',
      display_name: 'app.ts',
      can_preview: true,
      can_browse_directory: true,
    });
    expect(presentation.detailLines.some((line) => ['content', 'file_path', 'operation'].includes(line.label))).toBe(false);
    expect(presentation.detailBlocks).toEqual([{
      kind: 'file_read',
      action: {
        action_id: 'read_app',
        display_name: 'app.ts',
        can_preview: true,
        can_browse_directory: true,
      },
      content: 'const value = 1;\n',
      line_offset: 7,
      line_count: 1,
      total_lines: 42,
      truncated: false,
    }]);
  });

  it('strips content-ref suffixes from file labels when display_name is absent', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'file.read',
      renderer: 'file',
      label: 'a.md#dcbdf9b8c27f#e1703606242a',
      payload: {
        operation: 'read',
        content: 'hello\n',
        line_offset: 1,
        line_count: 1,
        total_lines: 1,
      },
    }));

    expect(presentation.label).toBe('Read a.md');
    expect(presentation.title).toEqual({ kind: 'file', verb: 'Read', display_name: 'a.md' });
  });

  it('renders file writes as Edit with unified patch data only', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'file.write',
      renderer: 'file',
      payload: {
        operation: 'write',
        display_name: 'app.ts',
        file_action_id: 'edit_app',
        change_type: 'update',
        additions: 1,
        deletions: 1,
        unified_diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,1 @@\n-const value = 1;\n+const value = 2;',
      },
    }), fileActions);

    expect(presentation.label).toBe('Edit app.ts');
    expect(presentation.title).toEqual({ kind: 'file', verb: 'Edit', display_name: 'app.ts' });
    expect(presentation.detailLines.some((line) => line.value.includes('unified_diff') || line.value.includes('file_path'))).toBe(false);
    expect(presentation.detailBlocks).toEqual([{
      kind: 'file_diff',
      files: [{
        display_name: 'app.ts',
        old_path: '',
        new_path: '',
        change_type: 'update',
        action: {
          action_id: 'edit_app',
          display_name: 'app.ts',
          can_preview: true,
          can_browse_directory: true,
        },
        additions: 1,
        deletions: 1,
        patch_text: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,1 @@\n-const value = 1;\n+const value = 2;',
        truncated: false,
        diff_unavailable_reason: '',
      }],
    }]);
  });

  it('renders file error details even when a file detail block is present', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'file.read',
      renderer: 'file',
      status: 'error',
      label: 'app.ts',
      payload: {
        operation: 'read',
        display_name: 'app.ts',
        file_action_id: 'read_app',
        content: 'partial\n',
        line_offset: 1,
        line_count: 1,
        total_lines: 10,
        status: 'error',
        error: {
          code: 'PERMISSION_DENIED',
          message: 'permission denied',
          retryable: false,
        },
      },
    }), fileActions);

    expect(presentation.detailBlocks.map((block) => block.kind)).toEqual(['file_read', 'structured']);
    const rows = presentation.detailLines.map((line) => `${line.label}:${line.value}`);
    expect(rows).toContain('result status:error');
    expect(rows).toContain('error code:PERMISSION_DENIED');
    expect(rows).toContain('error message:permission denied');
    expect(presentation.detailLines.map((line) => line.label)).not.toContain('error');
  });

  it('renders multi-file apply_patch as Edit N files and keeps per-file actions', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'apply_patch',
      renderer: 'patch',
      payload: {
        operation: 'apply_patch',
        mutations: [
          {
            display_name: 'app.ts',
            file_action_id: 'edit_app',
            change_type: 'update',
            additions: 1,
            deletions: 1,
            unified_diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,1 @@\n-old\n+new',
          },
          {
            display_name: 'old.ts',
            file_action_id: 'delete_old',
            change_type: 'delete',
            deletions: 1,
            unified_diff: '--- a/src/old.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-remove',
          },
        ],
      },
    }), fileActions);

    expect(presentation.label).toBe('Edit 2 files');
    expect(presentation.title).toEqual({ kind: 'file', verb: 'Edit', display_name: '2 files' });
    expect(presentation.primaryAction).toBeUndefined();
    expect(presentation.detailLines.some((line) => line.value.includes('patch'))).toBe(false);
    expect(presentation.detailBlocks[0]).toMatchObject({
      kind: 'file_diff',
      files: [
        {
          display_name: 'app.ts',
          change_type: 'update',
          action: { action_id: 'edit_app', display_name: 'app.ts', can_preview: true, can_browse_directory: true },
        },
        {
          display_name: 'old.ts',
          change_type: 'delete',
          action: { action_id: 'delete_old', display_name: 'old.ts', can_preview: false, can_browse_directory: true },
        },
      ],
    });
  });

  it('renders patch error details even when diff details are present', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'apply_patch',
      renderer: 'patch',
      status: 'error',
      payload: {
        operation: 'apply_patch',
        status: 'error',
        mutations: [{
          display_name: 'app.ts',
          file_action_id: 'edit_app',
          change_type: 'update',
          unified_diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,1 @@\n-old\n+new',
        }],
        error: {
          code: 'INVALID_ARGUMENTS',
          message: 'patch failed',
          retryable: false,
        },
      },
    }), fileActions);

    expect(presentation.detailBlocks.map((block) => block.kind)).toEqual(['file_diff', 'structured']);
    expect(presentation.detailLines.map((line) => `${line.label}:${line.value}`)).toContain('error code:INVALID_ARGUMENTS');
    expect(presentation.detailLines.map((line) => `${line.label}:${line.value}`)).toContain('error message:patch failed');
    expect(presentation.detailLines.map((line) => line.label)).not.toContain('error');
  });

  it('renders single-file apply_patch deletion as Delete', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'apply_patch',
      renderer: 'patch',
      payload: {
        operation: 'apply_patch',
        mutations: [{
          display_name: 'old.ts',
          file_action_id: 'delete_old',
          change_type: 'delete',
          unified_diff: '--- a/src/old.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-remove',
        }],
      },
    }), fileActions);

    expect(presentation.label).toBe('Delete old.ts');
    expect(presentation.title).toEqual({ kind: 'file', verb: 'Delete', display_name: 'old.ts' });
    expect(presentation.primaryAction).toEqual({
      action_id: 'delete_old',
      display_name: 'old.ts',
      can_preview: false,
      can_browse_directory: true,
    });
  });

  it('keeps every row expandable with a neutral fallback title', () => {
    const presentation = presentFlowerActivityItem(item({
      payload: undefined,
      renderer: undefined,
      label: undefined,
    }));

    expect(presentation.label).toBe('Activity');
    expect(presentation.meta).not.toContain('terminal.exec');
    expect(presentation.detailLines.length).toBeGreaterThan(0);
    expect(presentation.detailLines.map((line) => line.label)).toContain('status');
    expect(presentation.detailBlocks.length).toBeGreaterThan(0);
  });

  it('renders structured use_skill payloads with their real result fields', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'use_skill',
      renderer: 'structured',
      label: 'frontend-design',
      payload: {
        operation: 'use_skill',
        name: 'frontend-design',
        content: 'Loaded frontend design guidance.',
        content_ref: 'content_123',
        activation_id: 'act_123',
        already_active: false,
      },
    }));

    const rows = presentation.detailLines.map((line) => `${line.label}:${line.value}`);
    expect(rows).toContain('operation:use_skill');
    expect(rows).toContain('name:frontend-design');
    expect(rows).toContain('content:Loaded frontend design guidance.');
    expect(rows).toContain('content ref:content_123');
    expect(rows).toContain('activation:act_123');
    expect(rows).not.toContain('tool:use_skill');
  });
});
