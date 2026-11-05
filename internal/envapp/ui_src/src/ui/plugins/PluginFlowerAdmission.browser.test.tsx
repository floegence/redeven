import '../../index.css';
import '../flower-feature.css';
import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adapter, renderSurfaceWithAdapterProps, waitFor } from '../FlowerSurface.navigation.testHarness';
import { streamingFixture } from '../../../../../flower_ui/testing/streamingFixture';
import type { FlowerConversationParts } from '../../../../../flower_ui/src';

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
            <button
              data-direct
              disabled={!value.canSubmit(threadID ? 'Begin implementing' : undefined)}
              onClick={() => void value.submit({ fallbackPrompt: threadID ? 'Begin implementing' : undefined })}
            >
              Create directly
            </button>
          </div>
        );
      },
    },
  });
  return { surface, parts: () => parts };
}
it('submits the same current draft and existing thread through direct intent', async () => {
  const base = adapter(true);
  const { surface, parts } = embedded(base, 'thread-1');
  await waitFor(() => Boolean(surface.querySelector('textarea')), 10000);
  await expect.poll(() => parts().threadID()).toBe('thread-1');
  await expect.element(page.getByRole('textbox')).toBeEnabled();
  await page.getByRole('textbox').fill('Create a focused timer');
  await expect.element(page.getByRole('button', { name: 'Create directly', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Create directly', exact: true }).click();
  await expect.poll(() => vi.mocked(base.launchTurn).mock.calls.length).toBe(1);
  expect(vi.mocked(base.launchTurn).mock.calls[0][0]).toMatchObject({
    thread_id: 'thread-1',
    prompt: 'Create a focused timer',
  });
});
it('can continue the existing requirements with an empty composer', async () => {
  const base = adapter(true);
  const { surface, parts } = embedded(base, 'thread-1');
  await waitFor(() => Boolean(surface.querySelector('textarea')), 10000);
  await expect.poll(() => parts().threadID()).toBe('thread-1');
  await expect.element(page.getByRole('textbox')).toBeEnabled();
  await expect.element(page.getByRole('button', { name: 'Create directly', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Create directly', exact: true }).click();
  await expect.poll(() => vi.mocked(base.launchTurn).mock.calls.length).toBe(1);
  expect(vi.mocked(base.launchTurn).mock.calls[0][0]).toMatchObject({
    thread_id: 'thread-1',
    prompt: 'Begin implementing',
  });
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
it('keeps unavailable plugin navigation and slash text from becoming a direct turn', async () => {
  const base = adapter(true);
  const { surface, parts } = embedded(base, 'thread-1');
  await waitFor(() => Boolean(surface.querySelector('textarea')), 10000);
  await expect.poll(() => parts().threadID()).toBe('thread-1');
  await expect.element(page.getByRole('textbox')).toBeEnabled();
  const input = surface.querySelector<HTMLTextAreaElement>('textarea')!;
  input.value = '/plugin';
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '/plugin' }));
  input.focus();
  await expect.element(page.getByRole('button', { name: 'Create directly', exact: true })).toBeDisabled();
  await userEvent.keyboard('{Enter}');
  expect(input.value).toBe('/plugin');
  expect(base.launchTurn).not.toHaveBeenCalled();
});

it('releases direct creation after a terminal update while its summary still names the same run', async () => {
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
  await expect.element(page.getByRole('button', { name: 'Create directly', exact: true })).toBeEnabled();
});
