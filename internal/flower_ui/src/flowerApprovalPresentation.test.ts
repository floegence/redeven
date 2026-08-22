import { describe, expect, it } from 'vitest';
import type { FlowerApprovalAction } from './contracts/flowerSurfaceContracts';
import { presentFlowerApproval } from './flowerApprovalPresentation';

const copy = {
  title: 'Allow the following action?',
  editFile: (target: string) => `Edit file: ${target}`,
  runCommand: 'Run command',
  accessNetwork: (target: string) => `Access network resource: ${target}`,
  executeAction: (label: string) => `Execute action: ${label}`,
  executeRequestedAction: 'Execute requested action',
  workingDirectory: (target: string) => `Working directory: ${target}`,
};

function action(input: Partial<FlowerApprovalAction> & Pick<FlowerApprovalAction, 'tool_name'>): FlowerApprovalAction {
  return {
    action_id: 'approval-a', origin: 'main_tool', run_id: 'run-a', tool_id: 'tool-a',
    state: 'requested', status: 'pending', requested_at_ms: 1, can_approve: true,
    summary: { label: 'Requested action' },
    ...input,
  };
}

describe('presentFlowerApproval', () => {
  it.each(['file.write', 'file.edit'])('presents %s as a file edit', (toolName) => {
    const presentation = presentFlowerApproval(action({
      tool_name: toolName,
      summary: { label: toolName, targets: [{ kind: 'file', label: '回声之王.md' }] },
    }), copy);

    expect(presentation).toMatchObject({
      title: 'Allow the following action?',
      operations: ['Edit file: 回声之王.md'],
    });
    expect(JSON.stringify(presentation)).not.toContain(toolName);
  });

  it('preserves every apply_patch file in order', () => {
    const presentation = presentFlowerApproval(action({
      tool_name: 'apply_patch',
      summary: {
        label: 'Apply patch', effects: ['write'],
        targets: [{ kind: 'file', label: 'a.ts' }, { kind: 'file', label: 'b.ts' }],
      },
    }), copy);

    expect(presentation.operations).toEqual(['Edit file: a.ts', 'Edit file: b.ts']);
  });

  it('presents commands and their working directory separately', () => {
    const presentation = presentFlowerApproval(action({
      tool_name: 'terminal.exec',
      summary: {
        label: 'Run shell command', command: 'pnpm test',
        targets: [
          { kind: 'command', label: 'pnpm test' },
          { kind: 'working_directory', label: '/workspace' },
        ],
      },
    }), copy);

    expect(presentation).toMatchObject({
      operations: ['Run command'],
      command: 'pnpm test',
      details: ['Working directory: /workspace'],
    });
  });

  it('presents network targets without internal kind prefixes', () => {
    const presentation = presentFlowerApproval(action({
      tool_name: 'web_fetch',
      summary: { label: 'Fetch page', targets: [{ kind: 'web_url', label: 'https://example.test/docs' }] },
    }), copy);

    expect(presentation.operations).toEqual(['Access network resource: https://example.test/docs']);
    expect(JSON.stringify(presentation)).not.toContain('web_url');
  });

  it('uses a safe generic fallback instead of an internal tool identifier', () => {
    const presentation = presentFlowerApproval(action({
      tool_name: 'internal.mutate_resource',
      summary: { label: 'internal.mutate_resource' },
    }), copy);

    expect(presentation.operations).toEqual(['Execute requested action']);
    expect(JSON.stringify(presentation)).not.toContain('internal.mutate_resource');
  });

  it('does not expose an internal dotted label from an otherwise unknown action', () => {
    const presentation = presentFlowerApproval(action({
      tool_name: 'custom_tool',
      summary: { label: 'internal.mutate_resource' },
    }), copy);

    expect(presentation.operations).toEqual(['Execute requested action']);
  });
});
