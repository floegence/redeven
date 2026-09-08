import '../index.css';
import './flower-feature.css';

import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';
import type { FlowerAttachmentUploadInput, FlowerReasoningCapability, FlowerThreadView } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  adapter, deferred, disposeRenderedSurface, inputRequest, liveBootstrap, launchReceipt,
  renderSurfaceWithDraftCoordinator, renderSurfaceWithFocusController, settingsSnapshot, thread, waitFor, flowerSurfaceNotifications,
} from './FlowerSurface.navigation.testHarness';

const capability: FlowerReasoningCapability = {
  kind: 'effort', supported_levels: ['high', 'max'], default_level: 'high', disable_supported: true,
};
const offThread = () => thread({ reasoning_selection: { level: 'off' }, reasoning_capability: capability });

function settings() {
  const value = settingsSnapshot();
  return { ...value, model_profile: {
    ...value.model_profile!, providers: value.model_profile!.providers.map((provider) => ({
      ...provider, models: provider.models.map((model) => ({ ...model, reasoning_capability: capability })),
    })),
  } };
}
let fixtureID = 0;
function fixture() {
  const drafts = createFlowerComposerDraftCoordinator();
  const base = {
    ...adapter(true),
    runtime: { ...adapter(true).runtime, runtime_id: `reasoning-${++fixtureID}` },
    launchTurn: vi.fn(async (input: Parameters<ReturnType<typeof adapter>['launchTurn']>[0]) => (
      launchReceipt(input.thread_id ?? 'created-thread', 'turn-launch', 'start', input.client_request_id)
    )),
    loadSettings: vi.fn(async () => settings()),
    listThreads: vi.fn(async () => [offThread()]),
    loadThread: vi.fn(async () => liveBootstrap(offThread())),
    setThreadReasoningSelection: vi.fn(async () => liveBootstrap(offThread())),
  };
  return { drafts, base };
}
const control = (surface: HTMLElement) => surface.querySelector<HTMLElement>('[data-flower-composer-control="model_reasoning"] .flower-reasoning-control-segment');
async function select(surface: HTMLElement, id = 'thread-1') {
  await waitFor(() => Boolean(surface.querySelector(`[data-thread-id="${id}"] button`)));
  surface.querySelector<HTMLButtonElement>(`[data-thread-id="${id}"] button`)!.click();
}

beforeEach(async () => { await page.viewport(1280, 900); });

describe('Flower reasoning settings authority', () => {
  it('keeps saved Off after a cold detail load without promoting High into the draft', async () => {
    const { drafts, base } = fixture();
    const detail = deferred<FlowerThreadView>();
    base.loadThread = vi.fn(() => detail.promise);
    const surface = renderSurfaceWithDraftCoordinator(base, drafts);
    await select(surface);
    await waitFor(() => base.loadThread.mock.calls.length > 0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(control(surface)?.textContent).toContain('Off');
    detail.resolve(liveBootstrap(offThread()));
    await waitFor(() => Boolean(control(surface)));
    expect(control(surface)?.textContent).toContain('Off');
    expect(drafts.read('thread-1')?.value.reasoning_selection).toBeUndefined();
    expect(base.setThreadReasoningSelection).not.toHaveBeenCalled();
  });

  it('shows a non-interactive placeholder when focusing a task whose settings are not loaded', async () => {
    const { base } = fixture();
    const detail = deferred<FlowerThreadView>();
    const focused = renderSurfaceWithFocusController({ ...base,
      listThreads: vi.fn(async () => []), loadThread: vi.fn(() => detail.promise),
    }, null);
    const surface = focused.runtime;
    await waitFor(() => control(surface)?.textContent?.includes('High') === true);
    focused.setFocusThreadRequest({ request_id: 'cold-focus', thread_id: 'thread-1' });
    await waitFor(() => Boolean(surface.querySelector('.flower-reasoning-loading')));
    const placeholder = surface.querySelector<HTMLElement>('.flower-reasoning-loading')!;
    expect(placeholder.getAttribute('aria-label')).toBe('Loading reasoning setting…');
    expect(placeholder.querySelector('button')).toBeNull();
    expect(placeholder.getBoundingClientRect().width).toBeGreaterThan(40);
    expect(control(surface)).toBeNull();
    detail.resolve(liveBootstrap(offThread()));
    await waitFor(() => control(surface)?.textContent?.includes('Off') === true);
    expect(surface.querySelector('.flower-reasoning-loading')).toBeNull();
  });

  it('does not let an old draft mask saved settings after remounting', async () => {
    const { drafts, base } = fixture();
    drafts.open('thread-1').mutate((value) => ({ ...value, reasoning_selection: { level: 'high' } }));
    for (let mount = 0; mount < 2; mount += 1) {
      const surface = renderSurfaceWithDraftCoordinator(base, drafts);
      await select(surface);
      await waitFor(() => base.loadThread.mock.calls.length > mount);
      expect(control(surface)?.textContent).toContain('Off');
      control(surface)!.querySelector('button')!.click();
      Array.from(control(surface)!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
        .find((item) => item.textContent?.trim() === 'Off')!.click();
      expect(control(surface)?.textContent).toContain('Off');
      disposeRenderedSurface(surface);
      surface.remove();
    }
    expect(base.setThreadReasoningSelection).not.toHaveBeenCalled();
  });

  it('shows the new-task default without making it an explicit draft choice', async () => {
    const { drafts, base } = fixture();
    const surface = renderSurfaceWithDraftCoordinator(base, drafts);
    await waitFor(() => control(surface)?.textContent?.includes('High') === true);
    expect(drafts.read('__new_thread__')?.value.reasoning_selection).toBeUndefined();
  });

  it.each(['ordinary', 'attachment', 'long_text'])('preserves explicit Off across remounts and %s submission', async (kind) => {
    const { drafts, base } = fixture();
    const upload = vi.fn(async (input: FlowerAttachmentUploadInput) => ({
      attachment_id: 'upl_reasoning', name: input.file.name, mime_type: input.file.type,
      size_bytes: input.file.size, digest_sha256: 'e'.repeat(64),
      locator: `attachment://v1/upl_reasoning/${input.file.name}`, source: input.source,
      capability_revision: 'reasoning-attachments',
    }));
    const configured = { ...base,
      loadAttachmentCapability: vi.fn(async () => ({
        model_id: 'openai/gpt-5.2', revision: 'reasoning-attachments', enabled: true,
        supports_long_text: true, max_attachments: 4, max_file_size_bytes: 1_000_000,
        max_total_size_bytes: 2_000_000, routes: { 'text/plain': 'tool_read' as const },
      })), uploadAttachment: upload,
    };
    let surface = renderSurfaceWithDraftCoordinator(configured, drafts);
    await waitFor(() => Boolean(control(surface)?.querySelector('button')));
    control(surface)!.querySelector('button')!.click();
    const off = Array.from(control(surface)!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
      .find((item) => item.textContent?.trim() === 'Off');
    expect(off).toBeDefined();
    off!.click();
    expect(drafts.read('__new_thread__').value.reasoning_selection).toEqual({ level: 'off' });
    disposeRenderedSurface(surface);
    surface.remove();
    surface = renderSurfaceWithDraftCoordinator(configured, drafts);
    await waitFor(() => control(surface)?.textContent?.includes('Off') === true);
    const textarea = surface.querySelector('textarea')!;
    if (kind === 'attachment') {
      const picker = surface.querySelector<HTMLInputElement>('input[type="file"]')!;
      const files = new DataTransfer();
      files.items.add(new File(['Attachment'], 'notes.txt', { type: 'text/plain' }));
      Object.defineProperty(picker, 'files', { configurable: true, value: files.files });
      picker.dispatchEvent(new Event('change', { bubbles: true }));
      await waitFor(() => upload.mock.calls.length === 1);
    }
    textarea.value = kind === 'long_text' ? 'Long text. '.repeat(5001) : 'Keep reasoning disabled';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const submit = surface.querySelector<HTMLButtonElement>('.flower-composer-submit')!;
    await waitFor(() => !submit.disabled);
    submit.click();
    await waitFor(() => base.launchTurn.mock.calls.length === 1);
    expect(base.launchTurn.mock.calls[0]![0]).toMatchObject({ reasoning_selection: { level: 'off' } });
    if (kind !== 'ordinary') {
      expect(upload).toHaveBeenCalledTimes(1);
      expect(base.launchTurn.mock.calls[0]![0].attachment_ids).toEqual(['upl_reasoning']);
    }
    expect(base.launchTurn.mock.calls[0]![0].thread_id).toBeUndefined();
    await waitFor(() => surface.querySelector('textarea')?.value === '');
  });

  it('retains Off after a failed save and ignores a late save response when another task is selected', async () => {
    const { drafts, base } = fixture();
    const peer = thread({ ...offThread(), thread_id: 'peer', reasoning_selection: { level: 'max' } });
    const patch = deferred<FlowerThreadView>();
    const save = vi.fn().mockRejectedValueOnce(new Error('Unable to save reasoning')).mockImplementationOnce(() => patch.promise);
    const surface = renderSurfaceWithDraftCoordinator({ ...base,
      listThreads: vi.fn(async () => [offThread(), peer]),
      loadThread: vi.fn(async (id) => liveBootstrap(id === 'peer' ? peer : offThread())),
      setThreadReasoningSelection: save,
    }, drafts);
    await select(surface);
    const chooseHigh = async () => {
      await waitFor(() => Boolean(control(surface)?.querySelector('button')));
      control(surface)!.querySelector('button')!.click();
      Array.from(control(surface)!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
        .find((item) => item.textContent?.trim() === 'High')!.click();
    };
    await chooseHigh();
    await waitFor(() => flowerSurfaceNotifications().some((notice) => notice.message === 'Unable to save reasoning'));
    expect(control(surface)?.textContent).toContain('Off');
    await chooseHigh();
    await select(surface, 'peer');
    patch.resolve(liveBootstrap(thread({ ...offThread(), reasoning_selection: { level: 'high' }, settings_revision: 2 })));
    await waitFor(() => control(surface)?.textContent?.includes('Max') === true);
    await select(surface);
    await waitFor(() => control(surface)?.textContent?.includes('High') === true);
    expect(drafts.read('peer').value.reasoning_selection).toBeUndefined();
  });

  it('does not include a stale reasoning draft in an existing-task send', async () => {
    const { drafts, base } = fixture();
    drafts.open('thread-1').mutate((value) => ({ ...value, reasoning_selection: { level: 'high' } }));
    const surface = renderSurfaceWithDraftCoordinator(base, drafts);
    await select(surface);
    await waitFor(() => control(surface)?.textContent?.includes('Off') === true);
    const textarea = surface.querySelector('textarea')!;
    textarea.value = 'Continue this task';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const submit = surface.querySelector<HTMLButtonElement>('.flower-composer-submit')!;
    await waitFor(() => !submit.disabled);
    submit.click();
    await waitFor(() => base.launchTurn.mock.calls.length === 1);
    expect(base.launchTurn.mock.calls[0]![0]).toMatchObject({ thread_id: 'thread-1' });
    expect(base.launchTurn.mock.calls[0]![0]).not.toHaveProperty('reasoning_selection');
    await waitFor(() => surface.querySelector('textarea')?.value === '');
  });

  it.each(['running', 'waiting_user'] as const)('keeps reasoning read-only in %s', async (status) => {
    const { drafts, base } = fixture();
    const waiting = thread({ ...offThread(), status, ...(status === 'waiting_user' ? { input_request: inputRequest() } : {}) });
    base.listThreads = vi.fn(async () => [waiting]);
    base.loadThread = vi.fn(async () => liveBootstrap(waiting));
    const surface = renderSurfaceWithDraftCoordinator(base, drafts);
    await select(surface);
    await waitFor(() => base.loadThread.mock.calls.length > 0);
    if (status === 'waiting_user') await waitFor(() => Boolean(surface.querySelector('[data-flower-input-request-prompt]')));
    else await waitFor(() => control(surface)?.textContent?.includes('Off') === true);
    expect(surface.querySelector('[data-flower-composer-control="model_reasoning"] .flower-reasoning-segment-button')).toBeNull();
  });
});
