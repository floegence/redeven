// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FlowerChatContextChips } from '../../../../../flower_ui/src/chat/FlowerChatContextChips';
import { parseChatContextAction } from '../../../../../flower_ui/src/chat/flowerChatContextModel';

const disposers: Array<() => void> = [];

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  document.body.replaceChildren();
});

function renderContext(action: unknown, canActivateChip?: Parameters<typeof FlowerChatContextChips>[0]['canActivateChip']): HTMLElement {
  const display = parseChatContextAction(action);
  if (!display) throw new Error('Expected linked context display.');
  const host = document.createElement('div');
  document.body.appendChild(host);
  disposers.push(render(() => (
    <FlowerChatContextChips contextDisplay={display} onChipClick={vi.fn()} canActivateChip={canActivateChip} />
  ), host));
  return host;
}

const baseAction = {
  schema_version: 2,
  action_id: 'assistant.ask.flower',
  provider: 'flower',
  target: { target_id: 'current', locality: 'auto' },
  source: { surface: 'terminal' },
  context: [{
    kind: 'terminal_selection',
    working_dir: '/workspace',
    selection_chars: 12_000,
  }],
  presentation: { label: 'Ask Flower', priority: 100 },
};

describe('Flower linked context chips', () => {
  it('renders metadata-only terminal context as a noninteractive note', () => {
    const host = renderContext(baseAction);
    const chip = host.querySelector('[data-flower-chat-context-chip="true"]');

    expect(chip?.tagName).toBe('DIV');
    expect(chip?.getAttribute('data-flower-chat-context-interactive')).toBe('false');
    expect(chip?.textContent).toContain('/workspace');
    expect(chip?.textContent).toContain('12,000 characters');
    expect(chip?.textContent).toContain('content not included');
    expect(host.querySelector('button')).toBeNull();
  });

  it('renders unsupported context as a noninteractive note', () => {
    const host = renderContext({
      ...baseAction,
      source: { surface: 'file_browser' },
      context: [{ kind: 'future_context', raw_payload: 'hidden' }],
    });
    const chip = host.querySelector('[data-flower-chat-context-chip="true"]');

    expect(chip?.tagName).toBe('DIV');
    expect(chip?.textContent).toContain('Unsupported linked context');
    expect(chip?.textContent).toContain('future_context');
    expect(chip?.textContent).not.toContain('hidden');
  });

  it('renders file and directory capabilities independently', () => {
    const action = {
      ...baseAction,
      source: { surface: 'file_browser' },
      context: [
        { kind: 'file_path', path: '/workspace/index.ts', is_directory: false },
        { kind: 'file_path', path: '/workspace/src', is_directory: true },
      ],
    };
    const host = renderContext(action, (chip) => chip.action?.type === 'open_linked_file_preview');
    const chips = host.querySelectorAll('[data-flower-chat-context-chip="true"]');

    expect(chips[0]?.tagName).toBe('BUTTON');
    expect(chips[0]?.getAttribute('data-flower-chat-context-interactive')).toBe('true');
    expect(chips[0]?.getAttribute('aria-label')).toBe('index.ts, /workspace/index.ts');
    expect(chips[1]?.tagName).toBe('DIV');
    expect(chips[1]?.getAttribute('data-flower-chat-context-interactive')).toBe('false');
    expect(chips[1]?.getAttribute('aria-label')).toBe('src, /workspace/src');
  });

  it('renders host actions as noninteractive when the host has no capability', () => {
    const host = renderContext({
      ...baseAction,
      source: { surface: 'file_preview' },
      context: [{ kind: 'file_path', path: '/workspace/index.ts', is_directory: false }],
    }, () => false);

    expect(host.querySelector('[data-flower-chat-context-chip="true"]')?.tagName).toBe('DIV');
    expect(host.querySelector('button')).toBeNull();
  });
});
