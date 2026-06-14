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
    expect(presentation.meta).toContain('completed 1');
    expect(presentation.detailLines.some((line) => line.label === 'todos' && line.value.includes('Inspect thread ordering'))).toBe(true);
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
  });
});
