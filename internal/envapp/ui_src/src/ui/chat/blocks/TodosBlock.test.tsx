// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TodosBlock } from './TodosBlock';

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('TodosBlock', () => {
  it('renders a progress-first task plan summary with highlighted active work', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TodosBlock
        version={3}
        updatedAtUnixMs={new Date(2026, 3, 6, 14, 5).getTime()}
        todos={[
          {
            id: 'todo_1',
            content: 'Inspect the current plan card rendering',
            status: 'completed',
            note: 'Verified the existing table layout in chat.',
          },
          {
            id: 'todo_2',
            content: 'Refine the visual hierarchy and spacing',
            status: 'in_progress',
            note: 'Align the plan card with Codex thread styling.',
          },
          {
            id: 'todo_3',
            content: 'Add regression coverage for the new presentation',
            status: 'pending',
          },
        ]}
      />
    ), host);

    expect(host.textContent).toContain('Updated plan');
    expect(host.textContent).toContain('3 tasks');
    expect(host.textContent).toContain('1 completed');
    expect(host.textContent).toContain('1 active step');
    expect(host.textContent).toContain('1 pending');
    expect(host.textContent).toContain('v3');
    expect(host.textContent).toContain('Updated 14:05');
    expect(host.querySelector('.chat-todos-progress-fill')?.getAttribute('style')).toContain('width: 33%');
    expect(host.querySelector('.chat-todos-item[data-status="in_progress"]')).not.toBeNull();
    expect(host.querySelector('.chat-todos-content-done')?.textContent).toContain('Inspect the current plan card rendering');
    expect(host.textContent).toContain('Align the plan card with Codex thread styling.');
  });

  it('renders a clean empty state without placeholder note cells', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TodosBlock
        version={0}
        updatedAtUnixMs={0}
        todos={[]}
      />
    ), host);

    expect(host.textContent).toContain('No tasks tracked yet.');
    expect(host.textContent).not.toContain('—');
    expect(host.querySelector('.chat-todos-footer-meta')).toBeNull();
  });
});
