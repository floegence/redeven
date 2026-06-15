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

  it('keeps every row expandable with identity details', () => {
    const presentation = presentFlowerActivityItem(item({
      payload: undefined,
      renderer: undefined,
      label: undefined,
    }));

    expect(presentation.label).toBe('terminal.exec');
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
