import '../../index.css';
import '../flower-feature.css';
import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adapter, blockedDecision, decision, renderSurfaceWithAdapterProps, waitFor } from '../FlowerSurface.navigation.testHarness';
import { streamingFixture } from '../../../../../flower_ui/testing/streamingFixture';
import type { FlowerConversationParts } from '../../../../../flower_ui/src';
import { flowerTurnAdmissionError } from '../../../../../flower_ui/src/flowerTurnAdmission';

function embedded(base: ReturnType<typeof adapter>, threadID?: string) {
  let parts!: FlowerConversationParts;
  const surface = renderSurfaceWithAdapterProps(base, {
    embeddedConversation: {
      scope: 'plugin-admission',
      threadID,
      render: (value) => {
        parts = value;
        return (
          <div style={{ height: '100%', display: 'flex', 'flex-direction': 'column' }}>
            <div style={{ flex: 1, 'min-height': 0 }}>{value.conversation}</div>
            {value.composer}
          </div>
        );
      },
    },
  });
  return { surface, parts: () => parts };
}
it('submits the current draft in the existing thread through the ordinary send action', async () => {
  const base = adapter(true);
  const { surface, parts } = embedded(base, 'thread-1');
  await waitFor(() => Boolean(surface.querySelector('textarea')), 10000);
  await expect.poll(() => parts().threadID()).toBe('thread-1');
  await expect.element(page.getByRole('textbox')).toBeEnabled();
  await page.getByRole('textbox').fill('Create a focused timer');
  await expect.element(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => vi.mocked(base.launchTurn).mock.calls.length).toBe(1);
  expect(vi.mocked(base.launchTurn).mock.calls[0][0]).toMatchObject({
    thread_id: 'thread-1',
    prompt: 'Create a focused timer',
  });
});
it('does not synthesize an implementation request from an empty composer', async () => {
  const base = adapter(true);
  const { surface, parts } = embedded(base, 'thread-1');
  await waitFor(() => Boolean(surface.querySelector('textarea')), 10000);
  await expect.poll(() => parts().threadID()).toBe('thread-1');
  await expect.element(page.getByRole('textbox')).toBeEnabled();
  await expect.element(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  surface.querySelector('textarea')!.focus();
  await userEvent.keyboard('{Enter}');
  expect(base.launchTurn).not.toHaveBeenCalled();
});
it('opens plugin navigation before a model is configured without dispatching a turn', async () => {
  const base = adapter(false),
    open = vi.fn();
  const surface = renderSurfaceWithAdapterProps(base, { onOpenPluginCreation: open });
  await waitFor(() => Boolean(surface.querySelector('textarea')), 10000);
  const input = surface.querySelector<HTMLTextAreaElement>('textarea')!;
  input.value = '/plugin';
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '/plugin' }));
  input.focus();
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => open.mock.calls.length).toBe(1);
  expect(base.launchTurn).not.toHaveBeenCalled();
});
it('keeps unavailable plugin navigation and slash text from becoming a model turn', async () => {
  const base = adapter(true);
  const { surface, parts } = embedded(base, 'thread-1');
  await waitFor(() => Boolean(surface.querySelector('textarea')), 10000);
  await expect.poll(() => parts().threadID()).toBe('thread-1');
  await expect.element(page.getByRole('textbox')).toBeEnabled();
  const input = surface.querySelector<HTMLTextAreaElement>('textarea')!;
  input.value = '/plugin';
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '/plugin' }));
  input.focus();
  expect(parts().canSubmit()).toBe(false);
  await userEvent.keyboard('{Enter}');
  expect(input.value).toBe('/plugin');
  expect(base.launchTurn).not.toHaveBeenCalled();
});

it('releases ordinary submission after a terminal update while its summary still names the same run', async () => {
  const fixture = streamingFixture(2, 0);
  embedded(fixture.adapter as ReturnType<typeof adapter>, fixture.thread.thread_id);
  await expect.element(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  const current = fixture.current();
  fixture.emit({ schema_version: 3, kind: 'thread.batch', thread_id: current.thread_id, facts_only: true, update: {
    thread_id: current.thread_id, turn_id: current.turn_id, run_id: current.run_id,
    base_version: current.view_version, view_version: current.view_version + 1,
    facts: { activity: 'idle', queue_count: 0, last_outcome: 'completed' }, items: [],
  } });
  fixture.emit({ schema_version: 3, kind: 'thread.batch', thread_id: current.thread_id, update: {
    thread_id: current.thread_id, turn_id: current.turn_id, run_id: current.run_id,
    base_version: current.view_version, view_version: current.view_version + 1,
    facts: { activity: 'idle', queue_count: 0, last_outcome: 'completed' }, items: [],
  } });
  await expect.element(page.getByRole('button', { name: 'Stop', exact: true })).not.toBeInTheDocument();
  await page.getByRole('textbox').fill('Refine the plugin layout');
  await expect.element(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
});

it('submits a contextual canvas comment in the same thread while preserving unsent composer text', async () => {
  const base = adapter(true);
  const { parts } = embedded(base, 'thread-1');
  await expect.poll(() => parts().threadID()).toBe('thread-1');
  await expect.element(page.getByRole('textbox')).toBeEnabled();
  await page.getByRole('textbox').fill('Keep this unfinished idea');
  await expect.poll(() => parts().canSubmitMessage?.()).toBe(true);
  const accepted = await parts().submitMessage?.({ prompt: 'Make the selected button smaller', context: {
    schema_version: 2, action_id: 'assistant.ask.flower', provider: 'flower',
    source: { surface: 'flower_composer' }, target: { target_id: 'current', locality: 'auto' },
    presentation: { label: 'Canvas comment', priority: 100 },
    context: [{ kind: 'text_snapshot', title: 'Selected element', content: 'Untrusted visual hint: button Save' }],
  } });
  expect(accepted).toBe(true);
  await expect.poll(() => vi.mocked(base.launchTurn).mock.calls.length).toBe(1);
  expect(vi.mocked(base.launchTurn).mock.calls[0][0]).toMatchObject({ thread_id: 'thread-1', prompt: 'Make the selected button smaller' });
  await expect.element(page.getByRole('textbox')).toHaveValue('Keep this unfinished idea');
});

it.each([true, false])('waits for handler resolution before dispatching a canvas comment (blocked: %s)', async (blocked) => {
  const base = adapter(true);
  let resolve!: (value: ReturnType<typeof blockedDecision>) => void;
  const pending = new Promise<ReturnType<typeof blockedDecision>>(done => { resolve = done; });
  vi.mocked(base.resolveHandler).mockImplementation(() => pending);
  const { parts, surface } = embedded(base, 'thread-1');
  try {
    await expect.poll(() => parts().threadID()).toBe('thread-1');
    await expect.poll(() => parts().canSubmitMessage?.()).toBe(true);
    expect(await parts().submitMessage?.({ prompt: 'Keep this review pending until Flower is ready', context: {
      schema_version: 2, action_id: 'assistant.ask.flower', provider: 'flower',
      source: { surface: 'flower_composer' }, target: { target_id: 'current', locality: 'auto' },
      presentation: { label: 'Canvas comment', priority: 100 }, context: [],
    } })).toBe(true);
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    expect(base.launchTurn).not.toHaveBeenCalled();
    resolve(blocked ? blockedDecision() : decision());
    if (blocked) {
      await expect.poll(() => surface.querySelector('[data-flower-transport-delivery="failed"]')).not.toBeNull();
      expect(base.launchTurn).not.toHaveBeenCalled();
    } else {
      await expect.poll(() => vi.mocked(base.launchTurn).mock.calls.length).toBe(1);
      expect(vi.mocked(base.launchTurn).mock.calls[0][0]).toMatchObject({
        thread_id: 'thread-1', prompt: 'Keep this review pending until Flower is ready',
      });
    }
  } finally { resolve(blockedDecision()); }
});

it('retains an uncertain contextual submission without dispatching a duplicate or consuming newer input', async () => {
  const base = adapter(true);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const original = base.launchTurn;
  const launchTurn = vi.fn(async input => { await pending; return original(input); });
  const delayed = { ...base, launchTurn };
  const { parts } = embedded(delayed, 'thread-1');
  await expect.poll(() => parts().threadID()).toBe('thread-1');
  await expect.poll(() => parts().canSubmitMessage?.()).toBe(true);
  const input = { prompt: 'Update this card', context: {
    schema_version: 2 as const, action_id: 'assistant.ask.flower' as const, provider: 'flower' as const,
    source: { surface: 'flower_composer' as const }, target: { target_id: 'current', locality: 'auto' as const },
    presentation: { label: 'Canvas comment', priority: 100 }, context: [],
  } };
  try {
    expect(await parts().submitMessage?.(input)).toBe(true);
    expect(await parts().submitMessage?.(input)).toBe(false);
    await page.getByRole('textbox').fill('A later unfinished thought');
    await expect.poll(() => launchTurn.mock.calls.length).toBe(1);
  } finally { release(); }
  await expect.element(page.getByRole('textbox')).toHaveValue('A later unfinished thought');
});

it('keeps a canvas comment recoverable when durable outbox storage fails', async () => {
  const base = adapter(true);
  const { parts, surface } = embedded(base, 'thread-1');
  await expect.poll(() => parts().canSubmitMessage?.()).toBe(true);
  await page.getByRole('textbox').fill('Keep the ordinary draft');
  const original = IDBDatabase.prototype.transaction;
  let failOnce = true;
  const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, stores, mode, options) {
    if (this.name === 'redeven-flower-transport' && mode === 'readwrite' && failOnce) {
      failOnce = false; throw new DOMException('Disk full', 'QuotaExceededError');
    }
    return original.call(this, stores, mode, options);
  });
  try {
    await expect(parts().submitMessage?.({ prompt: 'Preserve the selected card comment', context: {
      schema_version: 2, action_id: 'assistant.ask.flower', provider: 'flower',
      source: { surface: 'flower_composer' }, target: { target_id: 'current', locality: 'auto' },
      presentation: { label: 'Canvas comment', priority: 100 }, context: [],
    } })).rejects.toThrow('Disk full');
    expect(base.launchTurn).not.toHaveBeenCalled();
    await expect.element(page.getByRole('textbox')).toHaveValue('Keep the ordinary draft');
    await expect.poll(() => surface.querySelector('[data-flower-transport-delivery="failed"]')).not.toBeNull();
    const row = surface.querySelector<HTMLElement>('[data-flower-transport-delivery="failed"]')!;
    const request = row.dataset.flowerTransportOutboxId;
    row.querySelector<HTMLButtonElement>('[aria-label="Retry send"]')!.click();
    await expect.poll(() => vi.mocked(base.launchTurn).mock.calls.length).toBe(1);
    expect(vi.mocked(base.launchTurn).mock.calls[0][0]).toMatchObject({ client_request_id: request, prompt: 'Preserve the selected card comment' });
  } finally { transaction.mockRestore(); }
});

it('retries a lost canvas comment receipt with the original request and storage generation', async () => {
  const base = adapter(true);
  let generation = 'a'.repeat(32);
  const resolveStorageGeneration = vi.fn(async () => generation);
  vi.mocked(base.launchTurn).mockRejectedValueOnce(flowerTurnAdmissionError('unknown', new Error('Receipt lost')));
  const { parts, surface } = embedded({ ...base, resolveStorageGeneration }, 'thread-1');
  await expect.poll(() => parts().canSubmitMessage?.()).toBe(true);
  await page.getByRole('textbox').fill('Keep the independent draft');
  expect(await parts().submitMessage?.({ prompt: 'Refine this button', context: {
    schema_version: 2, action_id: 'assistant.ask.flower', provider: 'flower',
    source: { surface: 'flower_composer' }, target: { target_id: 'current', locality: 'auto' },
    presentation: { label: 'Canvas comment', priority: 100 }, context: [],
  } })).toBe(true);
  await expect.poll(() => surface.querySelector('[data-flower-transport-delivery="unknown"]')).not.toBeNull();
  const original = vi.mocked(base.launchTurn).mock.calls[0][0];
  expect(original.storage_generation).toBe(generation);
  generation = 'b'.repeat(32);
  const retry = surface.querySelector<HTMLButtonElement>('[data-flower-transport-delivery="unknown"] [aria-label="Retry send"]')!;
  retry.click(); retry.click();
  await expect.poll(() => vi.mocked(base.launchTurn).mock.calls.length).toBe(2);
  expect(vi.mocked(base.launchTurn).mock.calls[1][0]).toEqual(original);
  expect(resolveStorageGeneration).toHaveBeenCalledTimes(1);
  await expect.element(page.getByRole('textbox')).toHaveValue('Keep the independent draft');
});

it('retains the dedicated conversation when ordinary sidebar inventory excludes it', async () => {
  const fixture = streamingFixture(2, 0);
  const dedicatedAdapter = { ...fixture.adapter, listThreads: async () => [],
    connectLiveStream: async function* (input: Parameters<NonNullable<typeof fixture.adapter.connectLiveStream>>[0]) {
      for await (const envelope of fixture.adapter.connectLiveStream!(input)) {
        yield envelope.kind === 'ready' || envelope.kind === 'summary.batch' ? { ...envelope, summaries: [] } : envelope;
      }
    },
  };
  const { parts } = embedded(dedicatedAdapter as ReturnType<typeof adapter>, fixture.thread.thread_id);
  await expect.poll(() => parts().threadID()).toBe(fixture.thread.thread_id);
  await expect.element(page.getByRole('textbox')).toBeVisible();
  await page.getByRole('textbox').fill('Keep this plugin revision');
  for (let index = 0; index < 2; index++) {
    fixture.emit({ schema_version: 3, kind: 'ready', summaries: [], baseline_complete: false });
    fixture.emit({ schema_version: 3, kind: 'summary.batch', summaries: [], baseline_complete: true });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(parts().threadID()).toBe(fixture.thread.thread_id);
    await expect.element(page.getByRole('textbox')).toHaveValue('Keep this plugin revision');
  }
  fixture.append('The dedicated preview conversation remains connected.');
  await expect.element(page.getByText('The dedicated preview conversation remains connected.', { exact: false })).toBeVisible();
});
