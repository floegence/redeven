// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FlowerChatContextChips } from '../../../../../flower_ui/src/chat/FlowerChatContextChips';
import { parseChatContextAction } from '../../../../../flower_ui/src/chat/flowerChatContextModel';
import { parseChatMessageReferences } from '../../../../../flower_ui/src/chat/flowerChatContextModel';

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
    <FlowerChatContextChips
      contextDisplay={display}
			truncatedLabel="Truncated"
      onChipClick={vi.fn()}
      canActivateChip={canActivateChip}
    />
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
  it('rejects terminal context without canonical selection content', () => {
    expect(parseChatContextAction(baseAction)).toBeNull();
  });

  it('rejects the complete action when it contains an unsupported context item', () => {
    const action = {
      ...baseAction,
      source: { surface: 'file_browser' },
      context: [{ kind: 'future_context', raw_payload: 'hidden' }],
    };

    expect(parseChatContextAction(action)).toBeNull();
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
    expect(chips[0]?.querySelector('svg')?.getAttribute('data-file-icon-type')).toBe('ts');
    expect(chips[1]?.querySelector('svg')?.getAttribute('data-file-icon-kind')).toBe('folder');
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

  it('renders Floret canonical references in order without a queued-context authority', () => {
    const display = parseChatMessageReferences([
      { reference_id: 'context:0', kind: 'text', label: 'Quoted selection', text: 'quoted text', truncated: true },
      { reference_id: 'context:1', kind: 'directory', label: 'src', truncated: false },
    ]);
    if (!display) throw new Error('Expected canonical reference display.');
    const host = document.createElement('div');
    document.body.appendChild(host);
    disposers.push(render(() => (
      <FlowerChatContextChips
        contextDisplay={display}
			truncatedLabel="Truncated"
        onChipClick={vi.fn()}
      />
    ), host));

    const chips = host.querySelectorAll('[data-flower-chat-context-chip="true"]');
    expect(host.querySelector('[data-flower-context-authority]')?.getAttribute('data-flower-context-authority')).toBe('canonical_references');
    expect(host.textContent).not.toContain('Linked references');
    expect(host.querySelector('.flower-chat-context-chips-divider')).toBeNull();
    expect(chips[0]?.textContent).toContain('Quoted selection');
    expect(chips[0]?.tagName).toBe('BUTTON');
    expect(chips[1]?.textContent).toContain('src');
		expect(chips[1]?.tagName).toBe('BUTTON');
		expect(chips[0]?.getAttribute('aria-label')).toBe('Quoted selection, quoted text, Truncated');
		expect(chips[0]?.querySelector('.flower-chat-context-chip-truncated')?.textContent).toBe('Truncated');
	});

	it('preserves reference controls and icons through 300 snapshots and activates the latest data', async () => {
		const firstDisplay = parseChatMessageReferences([
			{ reference_id: 'context:file', kind: 'file', label: 'main.ts' },
		]);
		if (!firstDisplay) throw new Error('Expected canonical reference display.');
		const [display, setDisplay] = createSignal(firstDisplay);
		const activate = vi.fn();
		const host = document.createElement('div');
		document.body.appendChild(host);
		disposers.push(render(() => (
			<FlowerChatContextChips
				contextDisplay={display()}
				truncatedLabel="Truncated"
				onChipClick={activate}
			/>
		), host));

		const focusedChip = host.querySelector('button') as HTMLButtonElement;
		focusedChip.focus();
		const icon = focusedChip.querySelector('.flower-chat-context-chip-icon')!;
		const nodes = [...icon.childNodes];
		const records: MutationRecord[] = [];
		const observer = new MutationObserver((values) => records.push(...values));
		observer.observe(host, { childList: true, subtree: true });
		for (let index = 0; index < 300; index += 1) {
			setDisplay(parseChatMessageReferences([{ reference_id: 'context:file', kind: 'file', label: 'main.ts' }])!);
			await Promise.resolve();
		}
		records.push(...observer.takeRecords());
		observer.disconnect();
		expect(records).toHaveLength(0);
		expect([...icon.childNodes]).toEqual(nodes);
		const refreshedDisplay = parseChatMessageReferences([
			{ reference_id: 'context:file', kind: 'file', label: 'renamed-main.ts' },
		]);
		if (!refreshedDisplay) throw new Error('Expected refreshed canonical reference display.');
		setDisplay(refreshedDisplay);
		await Promise.resolve();

		const refreshedChip = host.querySelector('button') as HTMLButtonElement;
		expect(refreshedChip).toBe(focusedChip);
		expect(document.activeElement).toBe(focusedChip);
		expect(refreshedChip.textContent).toContain('renamed-main.ts');
		expect(refreshedChip.querySelector('svg')?.getAttribute('data-file-icon-type')).toBe('ts');
		refreshedChip.click();
		expect(activate).toHaveBeenCalledExactlyOnceWith(refreshedDisplay.chips[0]);
		setDisplay(parseChatMessageReferences([{ reference_id: 'context:file', kind: 'file', label: 'screen.png' }])!);
		await Promise.resolve();
		expect(host.querySelector('button')).toBe(focusedChip);
		expect(focusedChip.querySelector('svg')?.getAttribute('data-file-icon-type')).toBe('image');
	});

	it('prevents duplicate activation while pending and restores focus after completion', async () => {
		const display = parseChatMessageReferences([
			{ reference_id: 'context:file', kind: 'file', label: 'main.ts' },
		]);
		if (!display) throw new Error('Expected canonical reference display.');
		let finish!: () => void;
		const pending = new Promise<void>((resolve) => { finish = resolve; });
		const onChipClick = vi.fn(() => pending);
		const host = document.createElement('div');
		document.body.appendChild(host);
		disposers.push(render(() => (
			<FlowerChatContextChips
				contextDisplay={display}
				truncatedLabel="Truncated"
				onChipClick={onChipClick}
			/>
		), host));

		const chip = host.querySelector('button') as HTMLButtonElement;
		chip.focus();
		chip.click();
		chip.click();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(onChipClick).toHaveBeenCalledTimes(1);
		const pendingChip = host.querySelector('button') as HTMLButtonElement;
		expect(pendingChip.disabled).toBe(true);
		expect(pendingChip.getAttribute('aria-busy')).toBe('true');

		finish();
		await pending;
		await new Promise((resolve) => setTimeout(resolve, 0));
		const settledChip = host.querySelector('button') as HTMLButtonElement;
		expect(settledChip.disabled).toBe(false);
		expect(document.activeElement).toBe(settledChip);
	});
});
