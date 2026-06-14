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

describe('presentFlowerActivityItem', () => {
  it('uses the terminal command as the compact row label', () => {
    const presentation = presentFlowerActivityItem(item({
      renderer: 'terminal',
      label: 'npm run build -- --mode production',
      payload: {
        command: 'npm run build -- --mode production',
        cwd: '/workspace/app',
        exit_code: 0,
        stdout: 'built\n',
        stderr: '',
      },
      chips: [{ kind: 'exit_code', label: 'exit', value: '0', tone: 'neutral' }],
    }));

    expect(presentation.label).toBe('npm run build -- --mode production');
    expect(presentation.title).toEqual({ kind: 'command', command: 'npm run build -- --mode production' });
    expect(presentation.meta).toContain('exit 0');
    expect(presentation.detailLines.map((line) => `${line.label}:${line.value}`)).toContain('command:npm run build -- --mode production');
    expect(presentation.detailLines.map((line) => `${line.label}:${line.value}`)).toContain('stdout:built');
  });

  it('prefers the terminal payload command over a stale generic label', () => {
    const presentation = presentFlowerActivityItem(item({
      renderer: 'terminal',
      label: 'terminal.exec',
      payload: {
        command: 'pnpm test -- src/ui/chat/activity/activityDetailPresentation.test.ts',
      },
    }));

    expect(presentation.label).toBe('pnpm test -- src/ui/chat/activity/activityDetailPresentation.test.ts');
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
      label: '/workspace/src/app.ts',
      target_refs: [{ kind: 'file', label: '/workspace/src/app.ts', path: '/workspace/src/app.ts' }],
      payload: {
        operation: 'read',
        file_path: '/workspace/src/app.ts',
        content: 'const value = 1;\n',
        line_offset: 7,
        line_count: 1,
        total_lines: 42,
        truncated: false,
      },
    }));

    expect(presentation.label).toBe('Read /workspace/src/app.ts');
    expect(presentation.title).toEqual({ kind: 'file', verb: 'Read', path: '/workspace/src/app.ts' });
    expect(presentation.detailLines.some((line) => ['content', 'file_path', 'operation'].includes(line.label))).toBe(false);
    expect(presentation.detailBlocks).toEqual([{
      kind: 'file_read',
      action: {
        path: '/workspace/src/app.ts',
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

  it('renders file writes as Edit with side-by-side diff data only', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'file.write',
      renderer: 'file',
      payload: {
        operation: 'write',
        file_path: '/workspace/src/app.ts',
        change_type: 'update',
        original_file: 'const value = 1;\n',
        updated_file: 'const value = 2;\n',
        structured_diff: [{
          old_start: 1,
          old_lines: 1,
          new_start: 1,
          new_lines: 1,
          before: ['const value = 1;'],
          after: ['const value = 2;'],
          before_kinds: ['removed'],
          after_kinds: ['added'],
        }],
      },
    }));

    expect(presentation.label).toBe('Edit /workspace/src/app.ts');
    expect(presentation.title).toEqual({ kind: 'file', verb: 'Edit', path: '/workspace/src/app.ts' });
    expect(presentation.detailLines.some((line) => line.value.includes('original_file') || line.value.includes('updated_file'))).toBe(false);
    expect(presentation.detailBlocks).toEqual([{
      kind: 'file_diff',
      files: [{
        path: '/workspace/src/app.ts',
        change_type: 'update',
        action: {
          path: '/workspace/src/app.ts',
          can_preview: true,
          can_browse_directory: true,
        },
        hunks: [{
          old_start: 1,
          old_lines: 1,
          new_start: 1,
          new_lines: 1,
          before: ['const value = 1;'],
          after: ['const value = 2;'],
          before_kinds: ['removed'],
          after_kinds: ['added'],
        }],
        truncated: false,
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
            file_path: '/workspace/src/app.ts',
            change_type: 'update',
            structured_diff: [{ old_start: 1, old_lines: 1, new_start: 1, new_lines: 1, before: ['old'], after: ['new'], before_kinds: ['removed'], after_kinds: ['added'] }],
            original_file: 'old\n',
            updated_file: 'new\n',
          },
          {
            file_path: '/workspace/src/old.ts',
            change_type: 'delete',
            structured_diff: [{ old_start: 1, old_lines: 1, new_start: 1, new_lines: 0, before: ['remove'], after: [], before_kinds: ['removed'] }],
            original_file: 'remove\n',
            updated_file: '',
          },
        ],
      },
    }));

    expect(presentation.label).toBe('Edit 2 files');
    expect(presentation.title).toEqual({ kind: 'file', verb: 'Edit', path: '2 files' });
    expect(presentation.detailLines.some((line) => line.value.includes('original_file') || line.value.includes('patch'))).toBe(false);
    expect(presentation.detailBlocks[0]).toMatchObject({
      kind: 'file_diff',
      files: [
        {
          path: '/workspace/src/app.ts',
          change_type: 'update',
          action: { path: '/workspace/src/app.ts', can_preview: true, can_browse_directory: true },
        },
        {
          path: '/workspace/src/old.ts',
          change_type: 'delete',
          action: { path: '/workspace/src/old.ts', can_preview: false, can_browse_directory: true },
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
          file_path: '/workspace/src/old.ts',
          change_type: 'delete',
          structured_diff: [{ old_start: 1, old_lines: 1, new_start: 1, new_lines: 0, before: ['remove'], after: [] }],
        }],
      },
    }));

    expect(presentation.label).toBe('Delete /workspace/src/old.ts');
    expect(presentation.title).toEqual({ kind: 'file', verb: 'Delete', path: '/workspace/src/old.ts' });
  });

  it('preserves apply_patch context line kinds for diff rendering', () => {
    const presentation = presentFlowerActivityItem(item({
      tool_name: 'apply_patch',
      renderer: 'patch',
      payload: {
        operation: 'apply_patch',
        mutations: [{
          file_path: '/workspace/src/app.ts',
          change_type: 'update',
          structured_diff: [{
            old_start: 10,
            old_lines: 3,
            new_start: 10,
            new_lines: 3,
            before: ['shared before', 'old value', 'shared after'],
            after: ['shared before', 'new value', 'shared after'],
            before_kinds: ['context', 'removed', 'context'],
            after_kinds: ['context', 'added', 'context'],
          }],
        }],
      },
    }));

    const diff = presentation.detailBlocks[0];
    expect(diff).toMatchObject({
      kind: 'file_diff',
      files: [{
        hunks: [{
          before_kinds: ['context', 'removed', 'context'],
          after_kinds: ['context', 'added', 'context'],
        }],
      }],
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
});
