// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  FlowerSurfaceAdapter,
  FlowerWorkingDirectoryEntry,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  createFlowerComposerDraftCoordinator,
} from '../../../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';
import {
  adapter,
  deferred,
  launchReceipt,
  renderSurfaceWithAdapter,
  renderSurfaceWithDraftCoordinator,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Element.prototype.scrollIntoView = vi.fn();
});

const pathContext = {
  agentHomePathAbs: '/workspace',
  homePathAbs: '/workspace',
  defaultRootId: 'workspace',
  roots: [{
    id: 'workspace',
    label: 'Workspace',
    pathAbs: '/workspace',
    kind: 'workspace',
    permissions: { read: true, write: true },
  }],
} as const;

function composerReferenceAdapter(input: Readonly<{
  listEntries?: (path: string) => Promise<readonly FlowerWorkingDirectoryEntry[]>;
  launchTurn?: FlowerSurfaceAdapter['launchTurn'];
}> = {}): FlowerSurfaceAdapter {
  return {
    ...adapter(true),
    listThreads: vi.fn(async () => []),
    getWorkingDirectoryPathContext: vi.fn(async () => pathContext),
    listWorkingDirectoryEntries: vi.fn(async ({ path }) => input.listEntries?.(path) ?? []),
    launchTurn: input.launchTurn ?? vi.fn(async (turn) => (
      launchReceipt(turn.thread_id ?? 'thread-reference', turn.turn_id ?? 'turn-reference')
    )),
  };
}

async function typeComposerToken(runtime: ParentNode, value: string): Promise<HTMLTextAreaElement> {
  const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
  textarea.focus();
  textarea.value = value;
  textarea.setSelectionRange(value.length, value.length);
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('select', { bubbles: true }));
  return textarea;
}

function placeCaretAtEnd(textarea: HTMLTextAreaElement): void {
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

describe('Flower composer references', () => {
  it('separates directory reference from directory navigation for pointer and keyboard actions', async () => {
    const runtime = renderSurfaceWithAdapter(composerReferenceAdapter({
      listEntries: async (path) => {
        if (path === '/workspace') {
          return [
            { name: 'README.md', path: '/workspace/README.md', isDirectory: false, modifiedAt: 3 },
            { name: 'src', path: '/workspace/src', isDirectory: true, modifiedAt: 2 },
            { name: 'unrelated.ts', path: '/workspace/unrelated.ts', isDirectory: false, modifiedAt: 1 },
          ];
        }
        if (path === '/workspace/src') {
          return [
            { name: 'components', path: '/workspace/src/components', isDirectory: true, modifiedAt: 2 },
            { name: 'main.ts', path: '/workspace/src/main.ts', isDirectory: false, modifiedAt: 1 },
          ];
        }
        return [];
      },
    }));

    await waitFor(() => runtime.querySelector('.flower-working-dir-chip') !== null);
    const textarea = await typeComposerToken(runtime, '@src');
    await waitFor(() => runtime.querySelector('[data-kind="directory"]') !== null);
    const directoryRow = runtime.querySelector('[data-kind="directory"]') as HTMLButtonElement;
    const enterButton = directoryRow.querySelector('.flower-composer-reference-enter') as HTMLButtonElement;
    expect(enterButton).toBeTruthy();
    expect(runtime.querySelector('[data-kind="file"] .flower-composer-reference-enter')).toBeNull();

    const pointerDown = new Event('pointerdown', { bubbles: true, cancelable: true });
    enterButton.dispatchEvent(pointerDown);
    expect(pointerDown.defaultPrevented).toBe(true);
    enterButton.click();

    await waitFor(() => textarea.value === '@src/');
    await waitFor(() => runtime.querySelectorAll('[role="option"]').length === 2);
    expect(document.activeElement).toBe(textarea);
    expect(runtime.querySelector('.flower-composer-reference-chip')).toBeNull();
    expect(Array.from(runtime.querySelectorAll('[role="option"]')).map((option) => option.textContent))
      .toEqual(expect.arrayContaining([expect.stringContaining('components'), expect.stringContaining('main.ts')]));
    expect(runtime.textContent).not.toContain('unrelated.ts');

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    await waitFor(() => textarea.value === '@src/components/');
    expect(runtime.querySelector('.flower-composer-reference-chip')).toBeNull();

    await typeComposerToken(runtime, '@src');
    await waitFor(() => runtime.querySelector('[data-kind="directory"]') !== null);
    (runtime.querySelector('[data-kind="directory"] [role="option"]') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-composer-reference-chip') !== null);
    expect(textarea.value).toBe('');
  });

  it('uses Tab to enter a directory while leaving Shift+Tab and IME composition alone', async () => {
    const runtime = renderSurfaceWithAdapter(composerReferenceAdapter({
      listEntries: async (path) => path === '/workspace'
        ? [{ name: 'src', path: '/workspace/src', isDirectory: true, modifiedAt: 1 }]
        : [{ name: 'main.ts', path: '/workspace/src/main.ts', isDirectory: false, modifiedAt: 1 }],
    }));

    await waitFor(() => runtime.querySelector('.flower-working-dir-chip') !== null);
    const textarea = await typeComposerToken(runtime, '@src');
    await waitFor(() => runtime.querySelector('[role="option"]') !== null);

    const shiftTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    textarea.dispatchEvent(shiftTab);
    expect(shiftTab.defaultPrevented).toBe(false);
    expect(textarea.value).toBe('@src');

    const composingTab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    Object.defineProperty(composingTab, 'isComposing', { configurable: true, value: true });
    textarea.dispatchEvent(composingTab);
    expect(composingTab.defaultPrevented).toBe(false);
    expect(textarea.value).toBe('@src');

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    await waitFor(() => textarea.value === '@src/');
    await waitFor(() => runtime.querySelector('[role="option"]')?.textContent?.includes('main.ts') === true);
    expect(document.activeElement).toBe(textarea);
  });

  it('selects a directory with the keyboard and sends a valid reference-only action', async () => {
    const launchTurn = vi.fn(async (turn) => (
      launchReceipt(turn.thread_id ?? 'thread-reference', turn.turn_id ?? 'turn-reference')
    ));
    const runtime = renderSurfaceWithAdapter(composerReferenceAdapter({
      launchTurn,
      listEntries: async (path) => path === '/workspace'
        ? [
            { name: 'main.ts', path: '/workspace/main.ts', isDirectory: false, modifiedAt: 2 },
            { name: 'src', path: '/workspace/src', isDirectory: true, modifiedAt: 1 },
          ]
        : [],
    }));

    await waitFor(() => runtime.querySelector('.flower-working-dir-chip')?.textContent?.includes('workspace') === true);
    const textarea = await typeComposerToken(runtime, '@src');
    await waitFor(() => runtime.querySelector('[role="listbox"] [role="option"]') !== null);
    await waitFor(() => !(runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled);

    const listbox = runtime.querySelector('[role="listbox"]') as HTMLElement;
    expect(textarea.getAttribute('aria-autocomplete')).toBe('list');
    expect(textarea.getAttribute('aria-controls')).toBe(listbox.id);
    expect(listbox.closest('[data-floe-local-interaction-surface="true"]')).toBeTruthy();

    placeCaretAtEnd(textarea);
    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }));
    await waitFor(() => runtime.querySelector('.flower-composer-reference-chip') !== null);

    expect(textarea.value).toBe('');
    expect(runtime.querySelector('.flower-composer-reference-chip')?.getAttribute('data-reference-kind')).toBe('directory');
    const submit = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement;
    await waitFor(() => !submit.disabled);
    submit.click();
    await waitFor(() => launchTurn.mock.calls.length === 1);

    const turn = launchTurn.mock.calls[0]![0];
    expect(turn.prompt).toBe('');
    expect(turn.context_action).toEqual({
      schema_version: 2,
      action_id: 'assistant.ask.flower',
      provider: 'flower',
      target: { target_id: 'current', locality: 'auto' },
      source: { surface: 'flower_composer' },
      context: [{ kind: 'file_path', path: '/workspace/src', is_directory: true }],
      presentation: { label: 'Ask Flower', priority: 100 },
    });
    expect(JSON.parse(JSON.stringify(turn.context_action))).toEqual(turn.context_action);
  });

  it('deduplicates the same file reference and removes the selected token each time', async () => {
    const runtime = renderSurfaceWithAdapter(composerReferenceAdapter({
      listEntries: async (path) => path === '/workspace'
        ? [{ name: 'main.ts', path: '/workspace/main.ts', isDirectory: false, modifiedAt: 1 }]
        : [],
    }));

    await waitFor(() => runtime.querySelector('.flower-working-dir-chip') !== null);
    const textarea = await typeComposerToken(runtime, '@main');
    await waitFor(() => runtime.querySelector('[role="option"]') !== null);
    await waitFor(() => !(runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled);
    placeCaretAtEnd(textarea);
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => runtime.querySelectorAll('.flower-composer-reference-chip').length === 1);

    await typeComposerToken(runtime, '@main');
    await waitFor(() => runtime.querySelector('[role="option"]') !== null);
    await waitFor(() => !(runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled);
    placeCaretAtEnd(textarea);
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => textarea.value === '');

    expect(runtime.querySelectorAll('.flower-composer-reference-chip')).toHaveLength(1);
    expect(runtime.querySelector('.flower-composer-reference-chip')?.getAttribute('data-reference-kind')).toBe('file');
  });

  it('serializes rapid candidate activation against the shared in-memory draft', async () => {
    const runtime = renderSurfaceWithAdapter(composerReferenceAdapter({
      listEntries: async () => [
        { name: 'main.ts', path: '/workspace/main.ts', isDirectory: false, modifiedAt: 2 },
        { name: 'other.ts', path: '/workspace/other.ts', isDirectory: false, modifiedAt: 1 },
      ],
    }));

    await waitFor(() => runtime.querySelector('.flower-working-dir-chip') !== null);
    const textarea = await typeComposerToken(runtime, '@');
    await waitFor(() => runtime.querySelectorAll('[role="option"]').length === 2);
    const options = Array.from(runtime.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    options[0]!.click();
    options[1]!.click();

    await waitFor(() => runtime.querySelectorAll('.flower-composer-reference-chip').length === 1);
    expect(textarea.value).toBe('');
    expect(runtime.querySelectorAll('.flower-composer-reference-chip')).toHaveLength(1);
  });

  it('commits a selected reference synchronously without blocking the composer', async () => {
    const coordinator = createFlowerComposerDraftCoordinator();
    const runtime = renderSurfaceWithDraftCoordinator(composerReferenceAdapter({
      listEntries: async () => [{
        name: 'main.ts', path: '/workspace/main.ts', isDirectory: false, modifiedAt: 1,
      }],
    }), coordinator);

    await waitFor(() => runtime.querySelector('.flower-working-dir-chip') !== null);
    const textarea = await typeComposerToken(runtime, '@main');
    await waitFor(() => runtime.querySelector('[role="option"]') !== null);
    (runtime.querySelector('[role="option"]') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-composer-reference-chip') !== null);

    expect(runtime.querySelector('[role="listbox"]')).toBeNull();
    expect(textarea.closest('.flower-composer')?.getAttribute('aria-busy')).not.toBe('true');
    expect(textarea.readOnly).toBe(false);
    expect(textarea.value).toBe('');
    await typeComposerToken(runtime, 'after');
    expect(textarea.value).toBe('after');
  });

  it('blocks Enter while results load and suppresses IME keyCode 229 submission', async () => {
    const listing = deferred<readonly FlowerWorkingDirectoryEntry[]>();
    const launchTurn = vi.fn(async (turn) => (
      launchReceipt(turn.thread_id ?? 'thread-reference', turn.turn_id ?? 'turn-reference')
    ));
    const runtime = renderSurfaceWithAdapter(composerReferenceAdapter({
      launchTurn,
      listEntries: () => listing.promise,
    }));

    await waitFor(() => runtime.querySelector('.flower-working-dir-chip') !== null);
    const textarea = await typeComposerToken(runtime, '@');
    await waitFor(() => runtime.querySelector('[role="listbox"]')?.getAttribute('aria-busy') === 'true');

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const imeEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(imeEnter, 'keyCode', { configurable: true, value: 229 });
    textarea.dispatchEvent(imeEnter);

    expect(launchTurn).not.toHaveBeenCalled();
    expect(textarea.value).toBe('@');
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => runtime.querySelector('[role="listbox"]') === null);

    listing.resolve([{ name: 'main.ts', path: '/workspace/main.ts', isDirectory: false, modifiedAt: 1 }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.querySelector('[role="listbox"]')).toBeNull();
    expect(launchTurn).not.toHaveBeenCalled();
  });

  it('dismisses loading results when Tab moves focus away and ignores the late result', async () => {
    const listing = deferred<readonly FlowerWorkingDirectoryEntry[]>();
    const runtime = renderSurfaceWithAdapter(composerReferenceAdapter({
      listEntries: () => listing.promise,
    }));

    await waitFor(() => runtime.querySelector('.flower-working-dir-chip') !== null);
    const textarea = await typeComposerToken(runtime, '@');
    await waitFor(() => runtime.querySelector('[role="listbox"]')?.getAttribute('aria-busy') === 'true');
    const attachment = document.createElement('button');
    runtime.appendChild(attachment);
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    attachment.focus();
    await waitFor(() => runtime.querySelector('[role="listbox"]') === null);

    listing.resolve([{ name: 'main.ts', path: '/workspace/main.ts', isDirectory: false, modifiedAt: 1 }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(attachment);
  });

  it('dismisses ready results when focus moves to a composer action', async () => {
    const runtime = renderSurfaceWithAdapter(composerReferenceAdapter({
      listEntries: async () => [{
        name: 'main.ts', path: '/workspace/main.ts', isDirectory: false, modifiedAt: 1,
      }],
    }));

    await waitFor(() => runtime.querySelector('.flower-working-dir-chip') !== null);
    await typeComposerToken(runtime, '@main');
    await waitFor(() => runtime.querySelector('[role="option"]') !== null);
    const attachment = document.createElement('button');
    runtime.appendChild(attachment);
    attachment.focus();

    await waitFor(() => runtime.querySelector('[role="listbox"]') === null);
    expect(document.activeElement).toBe(attachment);
  });

  it('keeps composer focus while retrying a failed reference search', async () => {
    let attempts = 0;
    let failing = true;
    const runtime = renderSurfaceWithAdapter(composerReferenceAdapter({
      listEntries: async () => {
        attempts += 1;
        if (failing) throw new Error('listing failed');
        return [{ name: 'main.ts', path: '/workspace/main.ts', isDirectory: false, modifiedAt: 1 }];
      },
    }));

    await waitFor(() => runtime.querySelector('.flower-working-dir-chip') !== null);
    const textarea = await typeComposerToken(runtime, '@main');
    await waitFor(() => runtime.querySelector('.flower-composer-reference-retry') !== null);
    const retry = runtime.querySelector('.flower-composer-reference-retry') as HTMLButtonElement;
    const pointerDown = new Event('pointerdown', { bubbles: true, cancelable: true });
    retry.dispatchEvent(pointerDown);
    expect(pointerDown.defaultPrevented).toBe(true);
    failing = false;
    retry.click();

    await waitFor(() => runtime.querySelector('[role="option"]') !== null);
    expect(document.activeElement).toBe(textarea);
    expect(attempts).toBeGreaterThanOrEqual(2);
  });

  it('removes a reference chip and returns focus to the composer', async () => {
    const runtime = renderSurfaceWithAdapter(composerReferenceAdapter({
      listEntries: async () => [{
        name: 'main.ts', path: '/workspace/main.ts', isDirectory: false, modifiedAt: 1,
      }],
    }));

    await waitFor(() => runtime.querySelector('.flower-working-dir-chip') !== null);
    const textarea = await typeComposerToken(runtime, '@main');
    await waitFor(() => runtime.querySelector('[role="option"]') !== null);
    await waitFor(() => !(runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled);
    placeCaretAtEnd(textarea);
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => runtime.querySelector('.flower-composer-reference-chip-remove') !== null);

    (runtime.querySelector('.flower-composer-reference-chip-remove') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-composer-reference-chip') === null);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(document.activeElement).toBe(textarea);
  });

  it('preserves external focus after the last in-memory reference removal', async () => {
    const runtime = renderSurfaceWithDraftCoordinator(
      composerReferenceAdapter({
        listEntries: async () => [{
          name: 'main.ts', path: '/workspace/main.ts', isDirectory: false, modifiedAt: 1,
        }],
      }),
      createFlowerComposerDraftCoordinator(),
    );

    await waitFor(() => runtime.querySelector('.flower-working-dir-chip') !== null);
    const textarea = await typeComposerToken(runtime, '@main');
    await waitFor(() => runtime.querySelector('[role="option"]') !== null);
    placeCaretAtEnd(textarea);
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => runtime.querySelector('.flower-composer-reference-chip-remove') !== null);
    const remove = runtime.querySelector('.flower-composer-reference-chip-remove') as HTMLButtonElement;
    await waitFor(() => !remove.disabled);
    remove.focus();
    remove.click();

    const outside = document.createElement('button');
    runtime.appendChild(outside);
    outside.focus();

    await waitFor(() => runtime.querySelector('.flower-composer-reference-chip') === null);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(document.activeElement).toBe(outside);
  });

  it('moves focus to the adjacent chip after an in-memory reference removal', async () => {
    const runtime = renderSurfaceWithDraftCoordinator(
      composerReferenceAdapter({
        listEntries: async () => [
          { name: 'main.ts', path: '/workspace/main.ts', isDirectory: false, modifiedAt: 2 },
          { name: 'src', path: '/workspace/src', isDirectory: true, modifiedAt: 1 },
        ],
      }),
      createFlowerComposerDraftCoordinator(),
    );

    await waitFor(() => runtime.querySelector('.flower-working-dir-chip') !== null);
    const textarea = await typeComposerToken(runtime, '@main');
    await waitFor(() => runtime.querySelector('[role="option"]') !== null);
    placeCaretAtEnd(textarea);
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => runtime.querySelectorAll('.flower-composer-reference-chip-remove').length === 1);
    await typeComposerToken(runtime, '@src');
    await waitFor(() => runtime.querySelector('[role="option"]') !== null);
    placeCaretAtEnd(textarea);
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => runtime.querySelectorAll('.flower-composer-reference-chip-remove').length === 2);
    const remove = runtime.querySelector('.flower-composer-reference-chip-remove') as HTMLButtonElement;
    await waitFor(() => !remove.disabled);
    remove.focus();
    remove.click();

    await waitFor(() => runtime.querySelectorAll('.flower-composer-reference-chip-remove').length === 1);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(document.activeElement).toBe(runtime.querySelector('.flower-composer-reference-chip-remove'));
  });
});
