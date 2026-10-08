// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';

import type { FlowerTurnLauncherIntent } from './contracts/flowerSurfaceContracts';
import {
  FlowerTurnLauncherPanel,
  type FlowerTurnLauncherSubmitInput,
} from './FlowerTurnLauncherWindow';
import { flowerTurnAdmissionError } from './flowerTurnAdmission';
import { setFlowerTurnLauncherAttachmentSourcePath } from './flowerTurnLauncherCopy';

const intent: FlowerTurnLauncherIntent = {
  id: 'launcher-panel-test',
  source_surface: 'file_preview',
  initial_prompt: 'Inspect this file',
  suggested_working_dir: '/workspace/redeven',
  context_items: [
    {
      kind: 'file_path',
      path: '/workspace/redeven/main.go',
      is_directory: false,
    },
  ],
  notes: ['The file is linked as live context.'],
};

let host: HTMLDivElement;
let dispose: (() => void) | undefined;
let animationFrameCallbacks: FrameRequestCallback[];

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  animationFrameCallbacks = [];
  vi.stubGlobal('crypto', {
    getRandomValues: (values: Uint8Array) => { values.fill(0); values[15] = 1; return values; },
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    animationFrameCallbacks.push(callback);
    return animationFrameCallbacks.length;
  });
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host.remove();
  vi.unstubAllGlobals();
});

function renderPanel(overrides: Partial<Parameters<typeof FlowerTurnLauncherPanel>[0]> = {}) {
  const onClose = vi.fn();
  const onSubmit = vi.fn(async (_input: FlowerTurnLauncherSubmitInput) => undefined);
  const onContextAction = vi.fn();

  dispose = render(() => (
    <FlowerTurnLauncherPanel
      open
      intent={intent}
      onClose={onClose}
      onSubmit={onSubmit}
      onContextAction={onContextAction}
      {...overrides}
    />
  ), host);

  return { onClose, onSubmit, onContextAction };
}

describe('FlowerTurnLauncherPanel', () => {
  it('removes a reference from both the visible input and the submitted action without replacing the draft', async () => {
    const contextItems = [intent.context_items[0], { kind: 'file_path' as const, path: '/workspace/redeven/worker.go', is_directory: false }];
    const action = {
      schema_version: 2, action_id: 'assistant.ask.flower', provider: 'flower',
      target: { target_id: 'local:local', locality: 'current_runtime' },
      source: { surface: 'file_preview' }, context: contextItems,
      presentation: { label: 'Ask Flower', priority: 100 },
    };
    const { onSubmit } = renderPanel({ intent: { ...intent, context_items: contextItems, context_action: action } });
    const textarea = host.querySelector('textarea')!;
    textarea.value = 'Keep my question';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const remove = host.querySelector<HTMLButtonElement>('button[aria-label="Remove reference main.go"]');
    expect(remove).not.toBeNull();
    remove!.click();
    expect(host.querySelector('.flower-composer-context-references')?.textContent).toBe('worker.go');
    expect(textarea.value).toBe('Keep my question');
    (host.querySelector('[data-testid="flower-turn-launcher-inline-send"]') as HTMLButtonElement).click();
    await flushAsync();
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ prompt: 'Keep my question', intent: {
      context_items: [contextItems[1]], context_action: { ...action, context: [contextItems[1]] },
    } });
  });

  it('drops the action envelope when the last explicit reference is removed', async () => {
    const { onSubmit } = renderPanel({ intent: { ...intent, context_action: {
      schema_version: 2, action_id: 'assistant.ask.flower', provider: 'flower',
      target: { target_id: 'local:local', locality: 'current_runtime' },
      source: { surface: 'file_preview' }, context: intent.context_items,
      presentation: { label: 'Ask Flower', priority: 100 },
    } } });
    host.querySelector<HTMLButtonElement>('button[aria-label="Remove reference main.go"]')?.click();
    expect(host.querySelector('.flower-composer-context-references')).toBeNull();
    (host.querySelector('[data-testid="flower-turn-launcher-inline-send"]') as HTMLButtonElement).click();
    await flushAsync();
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ intent: { context_items: [] } });
    expect(onSubmit.mock.calls[0]?.[0].intent.context_action).toBeUndefined();
  });

  it('removes consolidated attachment snapshots along with their live file reference', async () => {
    const file = new File(['package main'], 'main.go');
    const other = new File(['diagram'], 'diagram.png');
    setFlowerTurnLauncherAttachmentSourcePath(file, '/workspace/redeven/main.go');
    const { onSubmit } = renderPanel({ intent: { ...intent, pending_attachments: [file, other] } });
    host.querySelector<HTMLButtonElement>('button[aria-label="Remove reference main.go"]')!.click();
    expect(host.querySelector('.flower-composer-context-references')?.textContent).toBe('diagram.png');
    (host.querySelector('[data-testid="flower-turn-launcher-inline-send"]') as HTMLButtonElement).click();
    await flushAsync();
    expect(onSubmit.mock.calls[0]?.[0].intent.context_items).toEqual([]);
    expect(onSubmit.mock.calls[0]?.[0].intent.pending_attachments).toEqual([other]);
  });

  it('renders the shared prompt, context projection, notes, and footer without FloatingWindow chrome', () => {
    const { onClose, onContextAction } = renderPanel();

    expect(host.textContent).toContain('What should we focus on?');
    expect(host.textContent).toContain('main.go');
    expect(host.querySelector('.flower-composer-context-source')?.getAttribute('title')).toContain('/workspace/redeven/main.go');
    expect(host.textContent).toContain('The file is linked as live context.');
    expect(host.textContent).toContain('/workspace/redeven');
    expect(host.querySelector('[data-floe-geometry-surface="floating-window"]')).toBeNull();
    const input = host.querySelector('[data-testid="flower-turn-launcher-editor-shell"]')!;
    expect(input.querySelector('.flower-composer-context-references')?.textContent).toContain('main.go');
    expect(host.querySelector('.flower-turn-launcher-message-surface')?.textContent).not.toContain('main.go');

    const contextButton = host.querySelector('button[title*="/workspace/redeven/main.go"]') as HTMLButtonElement;
    contextButton.click();
    expect(onContextAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'open_live_file_preview', path: '/workspace/redeven/main.go' }),
      expect.objectContaining({ label: 'main.go', tone: 'file' }),
    );

    const closeButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Close') as HTMLButtonElement;
    closeButton.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps selected text and its live-file action together inside the composer', () => {
    const { onContextAction } = renderPanel({ intent: {
      ...intent,
      context_items: [{ kind: 'file_selection', path: '/workspace/redeven/main.go', selection: 'func main() {}', selection_chars: 14 }],
    } });
    const input = host.querySelector('[data-testid="flower-turn-launcher-editor-shell"]')!;
    const buttons = Array.from(input.querySelectorAll<HTMLButtonElement>('.flower-composer-context-reference button'));
    expect(buttons).toHaveLength(3);
    buttons[0].click();
    expect(onContextAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'open_text_context_preview', body: 'func main() {}' }),
      expect.objectContaining({ tone: 'selection' }),
    );
    buttons[1].click();
    expect(onContextAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'open_live_file_preview', path: '/workspace/redeven/main.go' }),
      expect.objectContaining({ tone: 'selection' }),
    );
  });

  it('submits a trimmed prompt and keeps launcher actions disabled until submission settles', async () => {
    let finishSubmit: (() => void) | undefined;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => {
      finishSubmit = resolve;
    }));
    renderPanel({ onSubmit });

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '  explain the failure  ';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));

    const sendButton = host.querySelector('[data-testid="flower-turn-launcher-inline-send"]') as HTMLButtonElement;
    sendButton.click();
    await flushAsync();

    expect(onSubmit).toHaveBeenCalledWith({
      client_request_id: 'client_00000000-0000-4000-8000-000000000001',
      prompt: 'explain the failure',
      intent,
    });
    expect(textarea.disabled).toBe(true);
    expect(sendButton.disabled).toBe(true);
    expect(host.textContent).toContain('Sending');

    finishSubmit?.();
    await flushAsync();
    expect(textarea.disabled).toBe(false);
  });

  it('preserves a shell-owned draft instead of replacing it with the intent prompt', () => {
    const onDraftChange = vi.fn();
    renderPanel({
      draft: 'Keep this Activity draft',
      onDraftChange,
    });

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Keep this Activity draft');

    textarea.value = 'Updated Activity draft';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(onDraftChange).toHaveBeenCalledWith('Updated Activity draft');
  });

  it('projects submission errors and honors disabled initial autofocus', async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error('runtime unavailable');
    });
    renderPanel({ onSubmit, autoFocus: false });

    for (const callback of animationFrameCallbacks.splice(0)) callback(0);
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(document.activeElement).not.toBe(textarea);

    (host.querySelector('[data-testid="flower-turn-launcher-inline-send"]') as HTMLButtonElement).click();
    await flushAsync();

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('runtime unavailable');
  });

  it('reuses one client request identity when an unresolved submission is retried', async () => {
    let attempts = 0;
    const onSubmit = vi.fn(async (_input: FlowerTurnLauncherSubmitInput) => {
      attempts += 1;
      if (attempts === 1) throw flowerTurnAdmissionError('unknown', new Error('response lost'));
    });
    renderPanel({ onSubmit });

    const sendButton = host.querySelector('[data-testid="flower-turn-launcher-inline-send"]') as HTMLButtonElement;
    sendButton.click();
    await flushAsync();
    expect((host.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);
    const remove = host.querySelector<HTMLButtonElement>('button[aria-label="Remove reference main.go"]');
    expect(remove?.disabled).toBe(true);
    remove?.click();
    sendButton.click();
    await flushAsync();

    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[0]?.[0].client_request_id).toBe(
      onSubmit.mock.calls[1]?.[0].client_request_id,
    );
    expect(onSubmit.mock.calls[1]?.[0].intent).toBe(onSubmit.mock.calls[0]?.[0].intent);
  });
});
