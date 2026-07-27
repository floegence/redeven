// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  FlowerSurfaceAdapter,
  FlowerWorkingDirectoryEntry,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  createFlowerComposerDraftCoordinator,
  type FlowerComposerDraftPersistence,
  type FlowerComposerDraftSnapshot,
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

function createDeferredReferenceRemovalCoordinator(): Readonly<{
  coordinator: ReturnType<typeof createFlowerComposerDraftCoordinator>;
  mutationStarted: ReturnType<typeof deferred<void>>;
  allowMutation: ReturnType<typeof deferred<void>>;
  armMutation: () => void;
}> {
  const mutationStarted = deferred<void>();
  const allowMutation = deferred<void>();
  let mutationArmed = false;
  let remote: FlowerComposerDraftSnapshot = {
    scope_id: 'new',
    revision: 0,
    value: { text: '', attachments: [], references: [], mode: 'ordinary' },
    updated_at_unix_ms: 1,
  };
  const persistence: FlowerComposerDraftPersistence = {
    load: vi.fn(async () => remote),
    acquire: vi.fn(async (_scopeID, holderID) => {
      const lease = {
        lease_id: 'lease-reference-removal',
        scope_id: remote.scope_id,
        holder_id: holderID,
        acquired_revision: remote.revision,
        expires_at_unix_ms: Date.now() + 60_000,
      };
      return { state: 'owned' as const, snapshot: remote, lease };
    }),
    renew: vi.fn(async (_scopeID, holderID, leaseID) => ({
      state: 'owned' as const,
      snapshot: remote,
      lease: {
        lease_id: leaseID,
        scope_id: remote.scope_id,
        holder_id: holderID,
        acquired_revision: remote.revision,
        expires_at_unix_ms: Date.now() + 60_000,
      },
    })),
    mutate: vi.fn(async (_scopeID, _holderID, _leaseID, _expectedRevision, value) => {
      if (mutationArmed) {
        mutationStarted.resolve(undefined);
        await allowMutation.promise;
      }
      remote = {
        scope_id: remote.scope_id,
        revision: remote.revision + 1,
        value,
        updated_at_unix_ms: 2,
      };
      return { kind: 'committed' as const, snapshot: remote };
    }),
    release: vi.fn(async () => undefined),
  };
  return {
    coordinator: createFlowerComposerDraftCoordinator({ persistence }),
    mutationStarted,
    allowMutation,
    armMutation: () => { mutationArmed = true; },
  };
}

describe('Flower composer references', () => {
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

  it('serializes rapid candidate activation before awaiting the draft lease', async () => {
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

  it('keeps the focused composer read-only while a persisted reference mutation is pending', async () => {
    const mutationStarted = deferred<void>();
    const allowMutation = deferred<void>();
    const launchTurn = vi.fn(async (turn) => (
      launchReceipt(turn.thread_id ?? 'thread-reference', turn.turn_id ?? 'turn-reference')
    ));
    let remote: FlowerComposerDraftSnapshot = {
      scope_id: 'new',
      revision: 0,
      value: { text: '', attachments: [], references: [], mode: 'ordinary' },
      updated_at_unix_ms: 1,
    };
    const persistence: FlowerComposerDraftPersistence = {
      load: vi.fn(async () => remote),
      acquire: vi.fn(async (_scopeID, holderID) => {
        const lease = {
          lease_id: 'lease-reference-pending',
          scope_id: remote.scope_id,
          holder_id: holderID,
          acquired_revision: remote.revision,
          expires_at_unix_ms: Date.now() + 60_000,
        };
        return { state: 'owned' as const, snapshot: remote, lease };
      }),
      renew: vi.fn(async (_scopeID, holderID, leaseID) => ({
        state: 'owned' as const,
        snapshot: remote,
        lease: {
          lease_id: leaseID,
          scope_id: remote.scope_id,
          holder_id: holderID,
          acquired_revision: remote.revision,
          expires_at_unix_ms: Date.now() + 60_000,
        },
      })),
      mutate: vi.fn(async (_scopeID, _holderID, _leaseID, _expectedRevision, value) => {
        mutationStarted.resolve(undefined);
        await allowMutation.promise;
        remote = {
          scope_id: remote.scope_id,
          revision: remote.revision + 1,
          value,
          updated_at_unix_ms: 2,
        };
        return { kind: 'committed' as const, snapshot: remote };
      }),
      release: vi.fn(async () => undefined),
    };
    const coordinator = createFlowerComposerDraftCoordinator({ persistence });
    const runtime = renderSurfaceWithDraftCoordinator(composerReferenceAdapter({
      launchTurn,
      listEntries: async () => [{
        name: 'main.ts', path: '/workspace/main.ts', isDirectory: false, modifiedAt: 1,
      }],
    }), coordinator, 'reference-pending');

    await waitFor(() => runtime.querySelector('.flower-working-dir-chip') !== null);
    const textarea = await typeComposerToken(runtime, '@main');
    await waitFor(() => runtime.querySelector('[role="option"]') !== null);
    (runtime.querySelector('[role="option"]') as HTMLButtonElement).click();
    await mutationStarted.promise;
    await waitFor(() => textarea.readOnly);
    expect(runtime.querySelector('[role="listbox"]')).toBeNull();
    expect(textarea.closest('.flower-composer')?.getAttribute('aria-busy')).toBe('true');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    textarea.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(launchTurn).not.toHaveBeenCalled();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    textarea.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    const outside = document.createElement('button');
    runtime.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    textarea.value = '@main should-not-stick';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(textarea.value).toBe('@main');

    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        files: [],
        getData: (type: string) => type === 'text/plain' ? ' should-not-stick' : '',
      },
    });
    expect(textarea.dispatchEvent(paste)).toBe(false);
    expect(textarea.value).toBe('@main');
    expect((runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled).toBe(true);

    allowMutation.resolve(undefined);
    await waitFor(() => runtime.querySelector('.flower-composer-reference-chip') !== null && !textarea.readOnly);
    expect(textarea.value).toBe('');
    expect(document.activeElement).toBe(outside);
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

  it('preserves external focus while the last reference removal persists', async () => {
    const pending = createDeferredReferenceRemovalCoordinator();
    const runtime = renderSurfaceWithDraftCoordinator(
      composerReferenceAdapter({
        listEntries: async () => [{
          name: 'main.ts', path: '/workspace/main.ts', isDirectory: false, modifiedAt: 1,
        }],
      }),
      pending.coordinator,
      'reference-removal-external-focus',
    );

    await waitFor(() => runtime.querySelector('.flower-working-dir-chip') !== null);
    const textarea = await typeComposerToken(runtime, '@main');
    await waitFor(() => runtime.querySelector('[role="option"]') !== null);
    placeCaretAtEnd(textarea);
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => runtime.querySelector('.flower-composer-reference-chip-remove') !== null);
    const remove = runtime.querySelector('.flower-composer-reference-chip-remove') as HTMLButtonElement;
    await waitFor(() => !remove.disabled);
    pending.armMutation();
    remove.focus();
    remove.click();
    await pending.mutationStarted.promise;

    const outside = document.createElement('button');
    runtime.appendChild(outside);
    outside.focus();
    pending.allowMutation.resolve(undefined);

    await waitFor(() => runtime.querySelector('.flower-composer-reference-chip') === null);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(document.activeElement).toBe(outside);
  });

  it('moves focus to the adjacent chip after a persisted reference removal', async () => {
    const pending = createDeferredReferenceRemovalCoordinator();
    const runtime = renderSurfaceWithDraftCoordinator(
      composerReferenceAdapter({
        listEntries: async () => [
          { name: 'main.ts', path: '/workspace/main.ts', isDirectory: false, modifiedAt: 2 },
          { name: 'src', path: '/workspace/src', isDirectory: true, modifiedAt: 1 },
        ],
      }),
      pending.coordinator,
      'reference-removal-adjacent-focus',
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
    pending.armMutation();
    remove.focus();
    remove.click();
    await pending.mutationStarted.promise;
    pending.allowMutation.resolve(undefined);

    await waitFor(() => runtime.querySelectorAll('.flower-composer-reference-chip-remove').length === 1);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(document.activeElement).toBe(runtime.querySelector('.flower-composer-reference-chip-remove'));
  });
});
