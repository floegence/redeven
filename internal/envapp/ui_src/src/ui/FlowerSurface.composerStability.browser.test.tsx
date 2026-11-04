import '../index.css';
import './flower-feature.css';

import { createSignal } from 'solid-js';
import { page, userEvent } from 'vitest/browser';
import { expect, it, onTestFinished, vi } from 'vitest';
import type { FlowerAttachmentCapability, FlowerSurfaceAdapter, FlowerThreadView } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, deferred, liveBootstrap, renderSurfaceWithAdapterProps, settingsSnapshot, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

it.each(['light', 'dark'])('keeps the %s transcript free of focus lines while preserving keyboard interaction', async theme => {
  await page.viewport(1280, 900);
  const previousClass = document.documentElement.className;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.classList.toggle('light', theme === 'light');
  onTestFinished(() => { document.documentElement.className = previousClass; });
  const conversation = thread({ messages: Array.from({ length: 30 }, (_, index) => ({
    id: `message-${index}`, turn_id: `turn-${index}`, role: 'user', content: `Conversation message ${index}`,
    status: 'complete', created_at_ms: index + 1,
  })) });
  const host = renderSurfaceWithAdapterProps({ ...adapter(), loadThread: async () => liveBootstrap(conversation) }, {
    focusThreadRequest: { request_id: 'focus-transcript', thread_id: conversation.thread_id },
  });
  host.style.cssText = 'width:100%;height:800px';
  await waitFor(() => host.textContent?.includes('Conversation message 29') === true);
  const transcript = host.querySelector<HTMLElement>('.flower-chat-transcript')!;
  const composer = host.querySelector<HTMLElement>('.flower-composer')!;
  await document.fonts.ready;
  for (let index = 0; index < 5; index += 1) await frame();
  const bounds = composer.getBoundingClientRect().toJSON();
  await userEvent.click(transcript);
  await userEvent.keyboard('a');
  expect(document.activeElement).toBe(transcript);
  expect(transcript.matches(':focus-visible')).toBe(true);
  host.setAttribute('data-testid', 'transcript-keyboard-focus');
  await page.screenshot({ element: page.getByTestId('transcript-keyboard-focus'), path: `./__screenshots__/flower-transcript-keyboard-${theme}.png` });
  expect(getComputedStyle(transcript).boxShadow).toBe('none');
  expect(getComputedStyle(transcript).outlineStyle).toBe('none');
  expect(composer.getBoundingClientRect().toJSON()).toEqual(bounds);
  const scrollTop = transcript.scrollTop;
  expect(scrollTop).toBeGreaterThan(0);
  await userEvent.keyboard('{PageUp}');
  await waitFor(() => transcript.scrollTop < scrollTop);
  await userEvent.keyboard('{Shift>}{F10}{/Shift}');
  await waitFor(() => Boolean(document.querySelector('[role="menu"]')));
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  expect(menu.contains(document.activeElement)).toBe(true);
  await userEvent.keyboard('{Escape}');
  await waitFor(() => document.activeElement === transcript);
  expect(getComputedStyle(transcript).boxShadow).toBe('none');
});

it.each([
  ['full', 1280], ['full', 390], ['companion', 1280],
] as const)('retains the attachment button and isolated drafts through delayed thread and model loads (%s, %ipx)', async (presentation, width) => {
  await page.viewport(width, 900);
  const first = thread({ thread_id: 'first', title: 'First conversation' });
  const second = thread({ thread_id: 'second', title: 'Second conversation', model_id: 'openai/gpt-5-mini' });
  const secondView = deferred<FlowerThreadView>();
  const secondCapability = deferred<FlowerAttachmentCapability>();
  const capability = (modelID: string): FlowerAttachmentCapability => ({
    model_id: modelID, revision: `capability-${modelID}`, enabled: true, supports_long_text: true,
    max_attachments: 10, max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000, routes: {},
  });
  const client: FlowerSurfaceAdapter = {
    ...adapter(),
    listThreads: async () => [first, second],
    loadThread: vi.fn(async id => id === first.thread_id ? liveBootstrap(first) : secondView.promise),
    loadSettings: async () => {
      const settings = settingsSnapshot();
      return { ...settings, model_profile: { ...settings.model_profile!, providers: [{
        ...settings.model_profile!.providers[0]!, models: [
          { model_name: 'gpt-5.2', input_modalities: ['text'] },
          { model_name: 'gpt-5-mini', input_modalities: ['text'] },
        ],
      }] } };
    },
    loadAttachmentCapability: vi.fn(async modelID => modelID === second.model_id ? secondCapability.promise : capability(modelID)),
    uploadAttachment: vi.fn(async input => ({
      attachment_id: `upload-${input.file.name}`, name: input.file.name, mime_type: input.file.type, size_bytes: input.file.size,
      digest_sha256: 'a'.repeat(64), locator: `attachment://v1/upload-${input.file.name}/${input.file.name}`,
      source: input.source, capability_revision: input.capability_revision,
    })),
  };
  const [selection, setSelection] = createSignal({ request_id: 'first', thread_id: first.thread_id });
  const host = renderSurfaceWithAdapterProps(client, {
    presentation, companionOpen: true, layout: true, get focusThreadRequest() { return selection(); },
  });
  host.style.cssText = 'width:100%;height:800px';
  await waitFor(() => Boolean(host.querySelector('.flower-composer-attachment-button:not(:disabled)')));
  const button = host.querySelector<HTMLButtonElement>('.flower-composer-attachment-button')!;
  const editor = host.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
  const picker = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  const openPicker = vi.spyOn(picker, 'click').mockImplementation(() => undefined);
  onTestFinished(() => openPicker.mockRestore());
  const addFile = async (name: string) => {
    openPicker.mockClear();
    await userEvent.click(button);
    expect(openPicker).toHaveBeenCalledOnce();
    const transfer = new DataTransfer();
    transfer.items.add(new File(['Retain this attachment'], name, { type: 'application/octet-stream' }));
    Object.defineProperty(picker, 'files', { configurable: true, value: transfer.files });
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => host.querySelector('[data-attachment-status="staged_ready"]')?.textContent?.includes(name) === true);
  };
  await userEvent.fill(editor, 'First draft');
  await addFile('first.custom');
  const removals: Node[] = [];
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.removedNodes) {
      if (node === button || node.contains(button)) removals.push(node);
    }
  });
  observer.observe(host, { childList: true, subtree: true });
  onTestFinished(() => observer.disconnect());
  const expectStableButton = () => {
    expect(host.querySelector('.flower-composer-attachment-button')).toBe(button);
    expect(button.isConnected).toBe(true);
    expect(button.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(getComputedStyle(button).visibility).toBe('visible');
    expect(Number(getComputedStyle(button).opacity)).toBeGreaterThan(0);
    expect(button.querySelector('svg')).not.toBeNull();
    expect(removals).toHaveLength(0);
  };
  setSelection({ request_id: 'second', thread_id: second.thread_id });
  await waitFor(() => vi.mocked(client.loadThread).mock.calls.some(([id]) => id === second.thread_id));
  for (let index = 0; index < 4; index += 1) { await frame(); expectStableButton(); }
  expect(button.disabled).toBe(true);
  secondView.resolve(liveBootstrap(second));
  await waitFor(() => vi.mocked(client.loadAttachmentCapability!).mock.calls.some(([id]) => id === second.model_id));
  for (let index = 0; index < 4; index += 1) { await frame(); expectStableButton(); }
  expect(button.disabled).toBe(true);
  secondCapability.resolve(capability(second.model_id!));
  await waitFor(() => !button.disabled);
  expect(editor.value).toBe('');
  expect(host.querySelector('.flower-attachment-item')).toBeNull();
  await userEvent.fill(editor, 'Second draft');
  await addFile('second.custom');
  for (const [id, draft, name] of [
    ['first', 'First draft', 'first.custom'], ['second', 'Second draft', 'second.custom'],
    ['first', 'First draft', 'first.custom'],
  ] as const) {
    setSelection({ request_id: `${id}-${name}-${draft}`, thread_id: id });
    await waitFor(() => editor.value === draft && !button.disabled);
    expectStableButton();
    expect(host.querySelectorAll('.flower-attachment-item')).toHaveLength(1);
    expect(host.querySelector('.flower-attachment-item')?.textContent).toContain(name);
  }
  expect(client.uploadAttachment).toHaveBeenCalledTimes(2);
});

it.each(['read_only', 'capability_disabled', 'capability_failed'] as const)('keeps an unavailable attachment entry visible without opening the picker (%s)', async restriction => {
  const conversation = thread();
  const loadAttachmentCapability = vi.fn(async (): Promise<FlowerAttachmentCapability> => {
    if (restriction === 'capability_failed') throw new Error('Capability unavailable');
    return { model_id: conversation.model_id!, revision: 'restricted', enabled: restriction !== 'capability_disabled',
      supports_long_text: true, max_attachments: 10, max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000, routes: {} };
  });
  const host = renderSurfaceWithAdapterProps({
    ...adapter(), canMutate: restriction !== 'read_only',
    loadThread: async () => liveBootstrap(conversation), loadAttachmentCapability,
    uploadAttachment: vi.fn(),
  }, { focusThreadRequest: { request_id: 'restricted', thread_id: conversation.thread_id } });
  host.style.cssText = 'width:900px;height:800px';
  await waitFor(() => loadAttachmentCapability.mock.calls.length > 0);
  await frame();
  const button = host.querySelector<HTMLButtonElement>('.flower-composer-attachment-button')!;
  expect(button).not.toBeNull();
  expect(button.disabled).toBe(true);
  expect(button.getBoundingClientRect().width).toBeGreaterThan(0);
  expect(Number(getComputedStyle(button).opacity)).toBeGreaterThan(0);
  const picker = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  const openPicker = vi.spyOn(picker, 'click').mockImplementation(() => undefined);
  onTestFinished(() => openPicker.mockRestore());
  button.click();
  expect(openPicker).not.toHaveBeenCalled();
});
