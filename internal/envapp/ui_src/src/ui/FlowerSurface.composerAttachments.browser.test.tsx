import '../index.css';
import './flower-feature.css';

import { commands, page, userEvent } from 'vitest/browser';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import type {
  FlowerAttachmentCapability,
  FlowerAttachmentUploadInput,
  FlowerStagedAttachment,
  FlowerRuntimeCurrentView,
  FlowerSurfaceAdapter,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  adapter,
  deferred,
  renderSurfaceWithAdapter,
  renderSurfaceWithAdapterProps,
  settingsSnapshot,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';
import {
  FlowerAttachmentLane,
  type FlowerAttachmentLaneCopy,
} from '../../../../flower_ui/src/attachments/FlowerAttachmentLane';
import type { FlowerAttachmentItem } from '../../../../flower_ui/src/attachments/createFlowerAttachmentController';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';

function expectHorizontallyContained(child: DOMRect, parent: DOMRect): void {
  expect(child.left).toBeGreaterThanOrEqual(parent.left - 1);
  expect(child.right).toBeLessThanOrEqual(parent.right + 1);
}

async function imageFile(name: string): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 240;
  const paint = canvas.getContext('2d')!;
  paint.fillStyle = '#f5f7fa';
  paint.fillRect(0, 0, 400, 240);
  paint.strokeStyle = '#667085';
  paint.lineWidth = 3;
  paint.beginPath();
  paint.moveTo(120, 120);
  paint.lineTo(280, 120);
  paint.stroke();
  for (const [x, color] of [[24, '#23816d'], [152, '#d78c36'], [280, '#795c9b']] as const) {
    paint.fillStyle = color;
    paint.fillRect(x, 84, 96, 72);
  }
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((result) => resolve(result!), 'image/png'));
  return new File([blob], name, { type: 'image/png' });
}

describe('Flower composer attachment browser presentation', () => {
  it.each([
    ['positions.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'tool_read'],
    ['diagram.png', 'image/png', 'attachment_manifest'],
    ['recording.wav', 'audio/wav', 'attachment_manifest'],
    ['video.mp4', 'video/mp4', 'attachment_manifest'],
    ['unknown.custom', '', 'attachment_manifest'],
  ] as const)('stages and sends %s without capability rejection', async (name, mime, route) => {
    await page.viewport(1100, 800);
    const modelID = 'moonshot/kimi-k2.5';
    const file = new File([new Uint8Array([80, 75, 3, 4, 0, 255])], name, { type: mime });
    const base = adapter(true);
    const launchTurn = vi.fn(base.launchTurn);
    const surfaceAdapter: FlowerSurfaceAdapter = {
      ...base, launchTurn,
      loadSettings: async () => ({ ...settingsSnapshot(), model_profile: { schema_version: 1, current_model_id: modelID,
        providers: [{ id: 'moonshot', name: 'Kimi', type: 'moonshot', models: [{ model_name: 'kimi-k2.5', input_modalities: ['text'] }] }],
      }, provider_secrets: [{ provider_id: 'moonshot', provider_api_key_configured: true, web_search_api_key_configured: false }] }),
      loadAttachmentCapability: async () => ({ model_id: modelID, revision: 'binary-tool-access', enabled: true, supports_long_text: true,
        max_attachments: 10, max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000,
        routes: { 'application/octet-stream': route, 'application/pdf': route, 'image/png': route, 'text/plain': route },
      }),
      uploadAttachment: async input => ({ attachment_id: 'upl_positions', name: input.file.name, mime_type: 'application/octet-stream',
        size_bytes: input.file.size, digest_sha256: 'a'.repeat(64), locator: 'attachment://v1/upl_positions/' + name,
        source: input.source, capability_revision: input.capability_revision,
      }),
    };
    const runtime = renderSurfaceWithAdapter(surfaceAdapter);
    runtime.style.cssText = 'width:100%;height:720px';
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer textarea:not(:disabled)')));
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const picker = runtime.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(picker, 'files', { configurable: true, value: transfer.files });
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => Boolean(runtime.querySelector('[data-attachment-status="staged_ready"]')));
    expect(runtime.querySelector('[data-attachment-status="incompatible"]')).toBeNull();
    const editor = runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    editor.value = 'Inspect the attachment.';
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: editor.value }));
    expect((runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled).toBe(false);
    runtime.querySelector('.flower-composer')!.setAttribute('data-testid', 'spreadsheet-composer');
    if (route === 'tool_read') await page.screenshot({ element: page.getByTestId('spreadsheet-composer'), path: './__screenshots__/flower-spreadsheet-tool-access.png' });
    await userEvent.click(runtime.querySelector('.flower-composer-submit')!);
    await waitFor(() => launchTurn.mock.calls.length === 1);
    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Inspect the attachment.', attachment_ids: ['upl_positions'] }));
  });

  it.each([false, true])('keeps the exact body with an uploaded image through send and history reload (file=%s)', async (withFile) => {
    await page.viewport(1200, 900);
    const body = 'Explain the attached diagram.\n\nKeep this second paragraph after sending.';
    const modelID = 'deepseek/deepseek-flash';
    const image = await imageFile('diagram.png');
    const files = withFile ? [image, new File(['Review notes'], 'notes.txt', { type: 'text/plain' })] : [image];
    const conversation = thread({ thread_id: 'mixed-send-thread', model_id: modelID, messages: [] });
    let messageID = '';
    let current: FlowerRuntimeCurrentView = { thread_id: conversation.thread_id, view_version: 0, activity: 'idle', items: [] };
    const launchTurn = vi.fn<FlowerSurfaceAdapter['launchTurn']>(async input => {
      messageID = `user:${input.client_request_id}`;
      current = {
        thread_id: conversation.thread_id, view_version: 1, activity: 'active',
        turn_id: 'mixed-turn', run_id: 'mixed-run', run_progress: { phase: 'preparing' },
        items: [{
          id: messageID, turn_id: 'mixed-turn', run_id: 'mixed-run', ordinal: 1, kind: 'user',
          text: input.prompt,
          attachments: (input.attachment_ids ?? []).map(id => {
            const file = files.find(file => id === `upl_${file.name}`)!;
            return { name: file.name, mime_type: file.type, size_bytes: file.size,
              url: `/uploads/${id}?thread_id=mixed-send-thread&turn_id=mixed-turn` };
          }),
        }],
      };
      return { client_request_id: input.client_request_id, thread_id: conversation.thread_id, current };
    });
    const surfaceAdapter: FlowerSurfaceAdapter = {
      ...adapter(true), listThreads: async () => current.items?.length ? [applyFlowerRuntimeCurrentView(conversation, current)] : [],
      loadThread: vi.fn(async () => ({ thread: applyFlowerRuntimeCurrentView(conversation, current), current })), launchTurn,
      loadSettings: async () => ({ ...settingsSnapshot(), model_profile: { schema_version: 1, current_model_id: modelID,
        providers: [{ id: 'deepseek', name: 'DeepSeek', type: 'deepseek', models: [{ model_name: 'deepseek-flash', input_modalities: ['text', 'image'] }] }],
      }, provider_secrets: [{ provider_id: 'deepseek', provider_api_key_configured: true, web_search_api_key_configured: false }] }),
      loadAttachmentCapability: async () => ({ model_id: modelID, revision: 'mixed-send', enabled: true, supports_long_text: true,
        max_attachments: 10, max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000,
        routes: { 'image/png': 'native_full_content', 'text/plain': 'tool_read' },
      }),
      uploadAttachment: async input => ({ attachment_id: `upl_${input.file.name}`, name: input.file.name,
        mime_type: input.file.type, size_bytes: input.file.size, digest_sha256: 'a'.repeat(64),
        locator: `attachment://v1/upl_${input.file.name}/${input.file.name}`,
        source: input.source, capability_revision: input.capability_revision,
      }),
      loadMessageAttachment: vi.fn(async input => files.find(file => input.url.includes(`/upl_${file.name}?`))!),
    };
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    onTestFinished(() => write.mockRestore());
    const runtime = renderSurfaceWithAdapter(surfaceAdapter);
    runtime.style.cssText = 'width:100%;height:820px';
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer textarea:not(:disabled)')));
    const transfer = new DataTransfer();
    files.forEach(file => transfer.items.add(file));
    const picker = runtime.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(picker, 'files', { configurable: true, value: transfer.files });
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => runtime.querySelectorAll('[data-attachment-status="staged_ready"]').length === files.length);
    const editor = runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    editor.value = body;
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: body }));
    await userEvent.click(runtime.querySelector('.flower-composer-submit')!);
    await waitFor(() => launchTurn.mock.calls.length === 1);
    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({ prompt: body, attachment_ids: files.map(file => `upl_${file.name}`) }));

    async function expectCompleteMessage(host: HTMLElement) {
      await waitFor(() => Boolean(host.querySelector(`[data-flower-message-id="${messageID}"]`)));
      const message = host.querySelector<HTMLElement>(`[data-flower-message-id="${messageID}"]`)!;
      expect(message.querySelectorAll('.flower-message-bubble-user')).toHaveLength(1);
      const bubble = message.querySelector<HTMLElement>('.flower-message-bubble-user')!;
      expect(Array.from(bubble.querySelectorAll('p')).map(p => p.textContent)).toEqual(body.split('\n\n'));
      expect(bubble.getBoundingClientRect().height).toBeGreaterThan(0);
      await waitFor(() => Boolean(message.querySelector<HTMLImageElement>('.flower-message-image img')?.naturalWidth));
      expect(bubble.querySelector('.flower-message-image')).toBeNull();
      expect(message.querySelectorAll('.flower-message-file')).toHaveLength(withFile ? 1 : 0);
      await userEvent.click(message.querySelector('.flower-message-copy-button-user')!);
      expect(write).toHaveBeenLastCalledWith(body);
      return message;
    }
    await expectCompleteMessage(runtime);
    expect(editor.value).toBe('');
    runtime.style.display = 'none';
    const reloaded = renderSurfaceWithAdapterProps(surfaceAdapter, {
      focusThreadRequest: { request_id: 'reopen-mixed', thread_id: conversation.thread_id },
    });
    reloaded.style.cssText = 'width:100%;height:820px';
    const message = await expectCompleteMessage(reloaded);
    expect(surfaceAdapter.loadThread).toHaveBeenCalledWith(conversation.thread_id, expect.any(AbortSignal));
    message.setAttribute('data-testid', 'mixed-sent-message');
    await page.screenshot({ element: page.getByTestId('mixed-sent-message'), path: `./__screenshots__/flower-mixed-sent-${withFile ? 'image-file' : 'image'}.png` });
    await page.viewport(375, 900);
    await expectCompleteMessage(reloaded);
  });

  it('keeps a Flash image queued through capability loading and stages it without reselection', async () => {
    await page.viewport(1100, 800);
    const modelID = 'deepseek/deepseek-flash';
    const pending = deferred<FlowerAttachmentCapability>();
    const capability: FlowerAttachmentCapability = {
      model_id: modelID, revision: 'flash-browser-capability', enabled: true, supports_long_text: true,
      max_attachments: 10, max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000,
      routes: { 'image/png': 'native_full_content' },
    };
    const loadAttachmentCapability = vi.fn(() => pending.promise);
    const uploadAttachment = vi.fn(async (input: FlowerAttachmentUploadInput): Promise<FlowerStagedAttachment> => ({
      attachment_id: 'upl_flash_browser', name: input.file.name, mime_type: input.file.type,
      size_bytes: input.file.size, digest_sha256: 'a'.repeat(64), locator: 'attachment://v1/upl_flash_browser/diagram.png',
      source: input.source, capability_revision: input.capability_revision,
    }));
    const runtime = renderSurfaceWithAdapter({ ...adapter(true), listThreads: async () => [],
      loadSettings: async () => ({ ...settingsSnapshot(), model_profile: { schema_version: 1, current_model_id: modelID,
        providers: [{ id: 'deepseek', name: 'DeepSeek', type: 'deepseek', models: [{ model_name: 'deepseek-flash', input_modalities: ['text', 'image'] }] }],
      }, provider_secrets: [{ provider_id: 'deepseek', provider_api_key_configured: true, web_search_api_key_configured: false }] }),
      loadAttachmentCapability, uploadAttachment,
    });
    runtime.style.cssText = 'width:100%;height:760px';
    await waitFor(() => loadAttachmentCapability.mock.calls.length > 0);
    const transfer = new DataTransfer();
    transfer.items.add(await imageFile('diagram.png'));
    const picker = runtime.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(picker, 'files', { configurable: true, value: transfer.files });
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => Boolean(runtime.querySelector('[data-attachment-status="queued"]')));
    expect(runtime.querySelector('.flower-attachment-error')).toBeNull();
    expect(uploadAttachment).not.toHaveBeenCalled();
    pending.resolve(capability);
    await waitFor(() => Boolean(runtime.querySelector('[data-attachment-status="staged_ready"]')));
    expect(uploadAttachment).toHaveBeenCalledOnce();
    expect(uploadAttachment.mock.calls[0][0].model_id).toBe(modelID);
    expect(runtime.querySelector('.flower-attachment-feedback')).toBeNull();
  });

  it.each([false, true])('reveals removal through hover, keyboard, or touch without moving attachments (touch=%s)', async (touch) => {
    await page.viewport(900, 720);
    const media = commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void> };
    await media.emulateTouchInput(touch);
    const host = document.createElement('div');
    host.className = 'flower-surface';
    document.body.append(host);
    const previewURL = URL.createObjectURL(await imageFile('diagram.png'));
    const file: FlowerAttachmentItem = {
      local_id: 'file-hover', request_id: 'file-hover', attempt_id: 'file-hover', source: 'file',
      name: 'notes.txt', mime_type: 'text/plain', size_bytes: 100, status: 'staged_ready',
      loaded_bytes: 100, progress_indeterminate: false,
    };
    const image: FlowerAttachmentItem = { ...file, local_id: 'image-hover', name: 'diagram.png', mime_type: 'image/png', preview_url: previewURL };
    const [items, setItems] = createSignal<readonly FlowerAttachmentItem[]>([image, file]);
    const onRemove = vi.fn((id: string) => setItems((current) => current.filter((item) => item.local_id !== id)));
    const dispose = render(() => <>
      <button data-outside type="button">Outside</button>
      <FlowerAttachmentLane items={items()} copy={DEFAULT_FLOWER_SURFACE_COPY.attachments!}
        onRetry={vi.fn()} onReselect={vi.fn()} onCancel={vi.fn()} onRemove={onRemove} onRestore={vi.fn()} onPreview={vi.fn()} />
    </>, host);
    try {
      await userEvent.click(host.querySelector('[data-outside]')!);
      for (const expected of [image, file]) {
        const item = host.querySelector<HTMLElement>('.flower-attachment-item')!;
        const remove = item.querySelector<HTMLButtonElement>('.flower-attachment-remove')!;
        const initial = item.getBoundingClientRect().toJSON();
        expect(getComputedStyle(remove).opacity).toBe(touch ? '1' : '0');
        expect(getComputedStyle(remove).pointerEvents).toBe(touch ? 'auto' : 'none');
        if (!touch) {
          await userEvent.hover(item);
          expect(getComputedStyle(remove).opacity).toBe('1');
          expect(item.getBoundingClientRect().toJSON()).toEqual(initial);
          await userEvent.hover(host.querySelector('[data-outside]')!);
          expect(getComputedStyle(remove).opacity).toBe('0');
          await userEvent.keyboard('{Tab}');
          remove.focus();
          expect(remove.matches(':focus-visible')).toBe(true);
          expect(getComputedStyle(remove).opacity).toBe('1');
          expect(item.getBoundingClientRect().toJSON()).toEqual(initial);
          await userEvent.keyboard('{Enter}');
        } else {
          expect(remove.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
          await userEvent.click(remove);
        }
        expect(onRemove).toHaveBeenCalledWith(expected.local_id);
        // Clear the next-item focus restoration before checking its resting state.
        await userEvent.click(host.querySelector('[data-outside]')!);
      }
      expect(host.querySelectorAll('.flower-attachment-item')).toHaveLength(0);
    } finally {
      dispose(); host.remove(); URL.revokeObjectURL(previewURL);
      await media.emulateTouchInput(false);
    }
  });

  it('keeps image lifecycle feedback and touch actions inside a stationary thumbnail', async () => {
    await page.viewport(320, 720);
    const host = document.createElement('div');
    host.className = 'flower-surface';
    document.body.append(host);
    const previewURL = URL.createObjectURL(await imageFile('diagram.png'));
    const image: FlowerAttachmentItem = {
      local_id: 'image-lifecycle', request_id: 'request-image', attempt_id: 'attempt-image',
      source: 'file', name: 'diagram.png', mime_type: 'image/png', size_bytes: 100,
      status: 'uploading', preview_url: previewURL,
      loaded_bytes: 25, total_bytes: 100, progress_indeterminate: false,
    };
    const [items, setItems] = createSignal<readonly FlowerAttachmentItem[]>([image]);
    const copy = DEFAULT_FLOWER_SURFACE_COPY.attachments!;
    const onRetry = vi.fn();
    const onReselect = vi.fn();
    const dispose = render(() => <FlowerAttachmentLane
      items={items()} copy={copy} onRetry={onRetry} onReselect={onReselect}
      onCancel={vi.fn()} onRemove={vi.fn()} onRestore={vi.fn()} onPreview={vi.fn()}
    />, host);
    try {
      const item = host.querySelector<HTMLElement>('.flower-attachment-item')!;
      const before = item.getBoundingClientRect();
      for (const state of [
        image,
        { ...image, progress_indeterminate: true },
        { ...image, status: 'upload_error', error_code: 'attachment_upload_failed' },
        { ...image, status: 'reselect_required' },
        { ...image, status: 'upload_error' },
        { ...image, status: 'staged_ready' },
      ] as const) {
        setItems([state]);
        const bounds = item.getBoundingClientRect();
        expect(bounds.width).toBe(before.width);
        expect(bounds.height).toBe(before.height);
        expect(item.scrollWidth).toBeLessThanOrEqual(item.clientWidth + 1);
        for (const button of item.querySelectorAll<HTMLElement>('.flower-attachment-actions button')) {
          const actionBounds = button.getBoundingClientRect();
          expect(actionBounds.width).toBeGreaterThanOrEqual(44);
          expectHorizontallyContained(actionBounds, bounds);
        }
        const feedback = item.querySelector<HTMLElement>('.flower-attachment-feedback');
        if (feedback) {
          expectHorizontallyContained(feedback.getBoundingClientRect(), bounds);
          expect(feedback.scrollWidth).toBeLessThanOrEqual(feedback.clientWidth + 1);
          expect(feedback.getBoundingClientRect().top).toBeGreaterThanOrEqual(
            item.querySelector('.flower-attachment-actions')!.getBoundingClientRect().bottom,
          );
        }
        if (state.status === 'upload_error') await userEvent.click(item.querySelector(`button[aria-label="${copy.retry}"]`)!);
        if (state.status === 'reselect_required') await userEvent.click(item.querySelector(`button[aria-label="${copy.reselect}"]`)!);
      }
      expect(onRetry).toHaveBeenCalledWith(image.local_id);
      expect(onReselect).toHaveBeenCalledWith(image.local_id);
      expect(item.querySelector('.flower-attachment-feedback')).toBeNull();
    } finally {
      dispose(); host.remove(); URL.revokeObjectURL(previewURL);
    }
  });

  it.each([
    { presentation: 'full', width: 1280, surfaceWidth: 1200, theme: 'light' },
    { presentation: 'companion', width: 1280, surfaceWidth: 434, theme: 'light' },
    { presentation: 'full', width: 320, surfaceWidth: 320, theme: 'light' },
    { presentation: 'companion', width: 1280, surfaceWidth: 434, theme: 'dark' },
  ] as const)('shows compact image thumbnails in $presentation at $surfaceWidth px ($theme)', async ({ presentation, width, surfaceWidth, theme }) => {
    await page.viewport(width, 800);
    document.documentElement.classList.add(theme);
    const capability: FlowerAttachmentCapability = {
      model_id: 'openai/gpt-5.2', revision: 'image-browser-capability', enabled: true,
      supports_long_text: true, max_attachments: 4,
      max_file_size_bytes: 1_000_000, max_total_size_bytes: 2_000_000,
      routes: { 'image/png': 'native_full_content', 'text/plain': 'tool_read' },
    };
    const previewStagedAttachment = vi.fn(async () => undefined);
    const runtime = renderSurfaceWithAdapterProps({
      ...adapter(true),
      loadAttachmentCapability: vi.fn(async () => capability),
      uploadAttachment: vi.fn(async (input: FlowerAttachmentUploadInput): Promise<FlowerStagedAttachment> => ({
        attachment_id: `upl_${input.file.name}`, name: input.file.name,
        mime_type: input.file.type, size_bytes: input.file.size, digest_sha256: 'e'.repeat(64),
        locator: `attachment://v1/upl_${input.file.name}/${input.file.name}`,
        source: input.source, capability_revision: capability.revision,
      })),
      previewStagedAttachment,
    }, { presentation, companionOpen: true });
    Object.assign(runtime.style, { width: `${surfaceWidth}px`, height: '760px' });
    try {
      await waitFor(() => Boolean(runtime.querySelector('input[type="file"]')));
      const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
      await userEvent.fill(textarea, 'Review these diagrams');
      const picker = runtime.querySelector('input[type="file"]') as HTMLInputElement;
      const transfer = new DataTransfer();
      for (const name of ['overview.png', 'services.png', 'storage.png']) transfer.items.add(await imageFile(name));
      transfer.items.add(new File(['Deployment notes'], 'notes.txt', { type: 'text/plain' }));
      Object.defineProperty(picker, 'files', { configurable: true, value: transfer.files });
      picker.dispatchEvent(new Event('change', { bubbles: true }));
      await waitFor(() => runtime.querySelectorAll('[data-attachment-status="staged_ready"]').length === 4);
      const lane = runtime.querySelector('.flower-attachment-lane') as HTMLElement;
      const images = [...lane.querySelectorAll<HTMLElement>('[data-attachment-kind="image"]')];
      await userEvent.hover(textarea);
      expect(images).toHaveLength(3);
      expect(lane.scrollWidth).toBeLessThanOrEqual(lane.clientWidth + 1);
      for (const item of images) {
        const image = item.querySelector('img')!;
        await waitFor(() => image.complete && image.naturalWidth === 400);
        const bounds = item.getBoundingClientRect();
        expect(bounds.width).toBe(96);
        expect(bounds.height).toBe(80);
        expectHorizontallyContained(bounds, lane.getBoundingClientRect());
        expect(item.querySelector('.flower-attachment-name, .flower-attachment-meta, .flower-attachment-feedback')).toBeNull();
        expect(item.textContent).toBe('');
        const remove = item.querySelector<HTMLButtonElement>('.flower-attachment-actions button')!;
        expect(remove.getAttribute('aria-label')).toBe('Remove attachment');
        expect(getComputedStyle(remove).opacity).toBe('0');
        expect(getComputedStyle(remove).cursor).toBe('pointer');
        const removeBounds = remove.getBoundingClientRect();
        expect(Math.abs(removeBounds.top - bounds.top)).toBeLessThanOrEqual(1);
        expect(Math.abs(removeBounds.right - bounds.right)).toBeLessThanOrEqual(1);
        if (width === 320) expect(removeBounds.width).toBeGreaterThanOrEqual(44);
      }
      const file = lane.querySelector<HTMLElement>('[data-attachment-kind="file"]')!;
      expect(file.textContent).toBe('notes.txt');
      expect(file.querySelector('.flower-attachment-meta, .flower-attachment-feedback')).toBeNull();
      expect(file.getBoundingClientRect().height).toBe(width === 320 ? 44 : 32);
      expect(file.getBoundingClientRect().width).toBeLessThanOrEqual(200);
      await page.screenshot({ element: runtime.querySelector('.flower-composer')!, path: `__screenshots__/image-thumbnails-${presentation}-${surfaceWidth}-${theme}.png` });
      await userEvent.hover(images[0]);
      expect(getComputedStyle(images[0].querySelector('.flower-attachment-remove')!).opacity).toBe('1');
      expect(getComputedStyle(file.querySelector('.flower-attachment-remove')!).opacity).toBe('0');
      await page.screenshot({ element: runtime.querySelector('.flower-composer')!, path: `__screenshots__/attachment-hover-${presentation}-${surfaceWidth}-${theme}.png` });
      await userEvent.click(images[0].querySelector('button.flower-attachment-preview-trigger')!);
      await waitFor(() => previewStagedAttachment.mock.calls.length === 1);
      await userEvent.click(images[0].querySelector('.flower-attachment-actions button')!);
      await waitFor(() => lane.querySelectorAll('[data-attachment-kind="image"]').length === 2);
      expect(previewStagedAttachment).toHaveBeenCalledOnce();
      expect(textarea.value).toBe('Review these diagrams');
      expect(runtime.querySelectorAll('[data-attachment-status="staged_ready"]')).toHaveLength(3);
    } finally {
      document.documentElement.classList.remove(theme);
    }
  });

  it('contains reselect-required actions at 400-percent equivalent width with long German copy', async () => {
    await page.viewport(320, 720);
    const host = document.createElement('div');
    host.className = 'flower-surface';
    host.style.width = '100%';
    document.body.appendChild(host);
    const reselectLabel = 'Dieselbe lokale Datei erneut aus dem Dateisystem auswählen';
    const removeLabel = 'Diesen nicht mehr verfügbaren Anhang dauerhaft aus dem Entwurf entfernen';
    const longCopy: FlowerAttachmentLaneCopy = {
      listLabel: 'Angehängte Dateien und automatisch ausgelagerte lange Texte',
      retry: 'Hochladen dieser Datei erneut versuchen',
      reselect: reselectLabel,
      cancel: 'Hochladen dieser Datei abbrechen',
      remove: removeLabel,
      restore: 'Den vollständigen langen Text im Eingabefeld wiederherstellen',
      preview: 'Den vollständigen langen Text in einem neuen Fenster anzeigen',
      copyReference: 'Den kanonischen Verweispfad dieses Anhangs kopieren',
      uploading: 'Wird hochgeladen', queued: 'Wartet', ready: 'Bereit', failed: 'Fehlgeschlagen',
      incompatible: 'Nicht kompatibel', reselectRequired: 'Die lokale Datei muss erneut ausgewählt werden',
      errorTooLarge: 'Zu groß', errorCountExceeded: 'Zu viele Anhänge',
      errorTotalSizeExceeded: 'Gesamtgröße überschritten', errorUnsupported: 'Nicht unterstützt',
      errorInvalidEncoding: 'Ungültige Zeichenkodierung', errorUploadFailed: 'Hochladen fehlgeschlagen',
      errorUnavailable: 'Nicht verfügbar', lines: (count) => `${count} Textzeilen`,
      added: (name) => `${name} hinzugefügt.`, converted: (name) => `${name} ausgelagert.`,
      uploaded: (name) => `${name} hochgeladen.`, uploadFailedAnnouncement: (name) => `${name} fehlgeschlagen.`,
    };
    const item: FlowerAttachmentItem = {
      local_id: 'reselect-browser', request_id: 'request-browser', attempt_id: 'attempt-browser',
      source: 'file', name: 'außergewöhnlich-lange-beobachtungs-und-bereitstellungsnotizen.txt',
      mime_type: 'text/plain', size_bytes: 18_432, status: 'reselect_required',
      loaded_bytes: 0, total_bytes: 18_432, progress_indeterminate: false,
    };
    const onReselect = vi.fn();
    const onRemove = vi.fn();
    const dispose = render(() => (
      <FlowerAttachmentLane
        items={[item]} copy={longCopy} locale="de-DE" onRetry={vi.fn()} onReselect={onReselect}
        onCancel={vi.fn()} onRemove={onRemove} onRestore={vi.fn()}
      />
    ), host);
    try {
      await waitFor(() => host.querySelectorAll('.flower-attachment-actions button').length === 2);
      const lane = host.querySelector('.flower-attachment-lane') as HTMLElement;
      const attachment = host.querySelector('.flower-attachment-item') as HTMLElement;
      const actions = host.querySelector('.flower-attachment-actions') as HTMLElement;
      expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
      expect(lane.scrollWidth).toBeLessThanOrEqual(lane.clientWidth + 1);
      expect(attachment.scrollWidth).toBeLessThanOrEqual(attachment.clientWidth + 1);
      expect(actions.scrollWidth).toBeLessThanOrEqual(actions.clientWidth + 1);
      expectHorizontallyContained(attachment.getBoundingClientRect(), lane.getBoundingClientRect());
      expectHorizontallyContained(actions.getBoundingClientRect(), attachment.getBoundingClientRect());

      const reselect = actions.querySelector<HTMLButtonElement>(`button[aria-label="${reselectLabel}"]`);
      const remove = actions.querySelector<HTMLButtonElement>(`button[aria-label="${removeLabel}"]`);
      for (const button of [reselect, remove]) {
        expect(button).not.toBeNull();
        const bounds = button!.getBoundingClientRect();
        expect(bounds.width).toBeGreaterThanOrEqual(44);
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        expectHorizontallyContained(bounds, actions.getBoundingClientRect());
      }
      expect(reselect!.title).toBe(reselectLabel);
      expect(remove!.title).toBe(removeLabel);
      reselect!.click();
      remove!.click();
      expect(onReselect).toHaveBeenCalledWith(item.local_id);
      expect(onRemove).toHaveBeenCalledWith(item.local_id);
    } finally {
      dispose();
      host.remove();
    }
  });

  it('keeps every long-text action contained and touch-sized with long localized labels', async () => {
    await page.viewport(320, 720);
    const host = document.createElement('div');
    host.className = 'flower-surface';
    host.style.width = '100%';
    document.body.appendChild(host);
    const longCopy: FlowerAttachmentLaneCopy = {
      listLabel: 'Angehängte Dateien und automatisch ausgelagerte lange Texte',
      retry: 'Hochladen dieser Datei erneut versuchen',
      reselect: 'Dieselbe Datei erneut auswählen',
      cancel: 'Hochladen dieser Datei abbrechen',
      remove: 'Diesen Anhang dauerhaft aus dem Entwurf entfernen',
      restore: 'Den vollständigen langen Text im Eingabefeld wiederherstellen',
      preview: 'Den vollständigen langen Text in einem neuen Fenster anzeigen',
      copyReference: 'Den kanonischen Verweispfad dieses Anhangs kopieren',
      uploading: 'Wird hochgeladen', queued: 'Wartet', ready: 'Bereit', failed: 'Fehlgeschlagen',
      incompatible: 'Nicht kompatibel', reselectRequired: 'Erneut auswählen',
      errorTooLarge: 'Zu groß', errorCountExceeded: 'Zu viele Anhänge',
      errorTotalSizeExceeded: 'Gesamtgröße überschritten', errorUnsupported: 'Nicht unterstützt',
      errorInvalidEncoding: 'Ungültige Zeichenkodierung', errorUploadFailed: 'Hochladen fehlgeschlagen',
      errorUnavailable: 'Nicht verfügbar', lines: (count) => `${count} Textzeilen`,
      added: (name) => `${name} hinzugefügt.`, converted: (name) => `${name} ausgelagert.`,
      uploaded: (name) => `${name} hochgeladen.`, uploadFailedAnnouncement: (name) => `${name} fehlgeschlagen.`,
    };
    const item: FlowerAttachmentItem = {
      local_id: 'long-text-browser', request_id: 'request-browser', attempt_id: 'attempt-browser',
      source: 'long_text', name: 'sehr-lange-technische-spezifikation-mit-ausführlichen-beobachtungen.txt',
      mime_type: 'text/plain; charset=utf-8', size_bytes: 240_000, status: 'staged_ready',
      loaded_bytes: 240_000, total_bytes: 240_000, progress_indeterminate: false,
      text_stats: { code_points: 220_000, lines: 4_321 },
      staged: {
        attachment_id: 'upl_long_text_browser',
        name: 'sehr-lange-technische-spezifikation-mit-ausführlichen-beobachtungen.txt',
        mime_type: 'text/plain; charset=utf-8', size_bytes: 240_000, digest_sha256: 'f'.repeat(64),
        locator: 'attachment://v1/upl_long_text_browser/specification.txt', source: 'long_text',
        capability_revision: 'browser-capability', text_stats: { code_points: 220_000, lines: 4_321 },
      },
    };
    const dispose = render(() => (
      <FlowerAttachmentLane
        items={[item]} copy={longCopy} locale="de-DE" onRetry={vi.fn()} onReselect={vi.fn()}
        onCancel={vi.fn()} onRemove={vi.fn()} onRestore={vi.fn()} onPreview={vi.fn()}
      />
    ), host);
    try {
      await waitFor(() => host.querySelectorAll('.flower-attachment-actions button').length === 2);
      const lane = host.querySelector('.flower-attachment-lane') as HTMLElement;
      const attachment = host.querySelector('.flower-attachment-item') as HTMLElement;
      const actions = host.querySelector('.flower-attachment-actions') as HTMLElement;
      expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
      expect(lane.scrollWidth).toBeLessThanOrEqual(lane.clientWidth + 1);
      expect(attachment.scrollWidth).toBeLessThanOrEqual(attachment.clientWidth + 1);
      expect(actions.scrollWidth).toBeLessThanOrEqual(actions.clientWidth + 1);
      expectHorizontallyContained(attachment.getBoundingClientRect(), lane.getBoundingClientRect());
      expectHorizontallyContained(actions.getBoundingClientRect(), attachment.getBoundingClientRect());
      const actionLabels = [longCopy.restore, longCopy.remove];
      for (const label of actionLabels) {
        const button = actions.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
        expect(button).not.toBeNull();
        const bounds = button!.getBoundingClientRect();
        expect(bounds.width).toBeGreaterThanOrEqual(44);
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        expectHorizontallyContained(bounds, actions.getBoundingClientRect());
      }
    } finally {
      dispose();
      host.remove();
    }
  });

  it('keeps attachment controls usable at 400-percent equivalent width and model guidance contained', async () => {
    await page.viewport(320, 720);
    const capability: FlowerAttachmentCapability = {
      model_id: 'openai/gpt-5.2',
      revision: 'browser-capability',
      enabled: true,
      supports_long_text: true,
      max_attachments: 4,
      max_file_size_bytes: 1_000_000,
      max_total_size_bytes: 2_000_000,
      routes: { 'text/plain': 'tool_read' },
    };
    const uploadAttachment = vi.fn(async (input: FlowerAttachmentUploadInput): Promise<FlowerStagedAttachment> => ({
      attachment_id: 'upl_browser_attachment',
      name: input.file.name,
      mime_type: input.file.type,
      size_bytes: input.file.size,
      digest_sha256: 'e'.repeat(64),
      locator: `attachment://v1/upl_browser_attachment/${input.file.name}`,
      source: input.source,
      capability_revision: capability.revision,
    }));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      loadAttachmentCapability: vi.fn(async () => capability),
      uploadAttachment,
      previewStagedAttachment: vi.fn(async () => undefined),
    });
    runtime.style.height = '680px';

    await waitFor(() => Boolean(runtime.querySelector('input[type="file"]')));
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.getBoundingClientRect().width).toBeGreaterThanOrEqual(128);
    const picker = runtime.querySelector('input[type="file"]') as HTMLInputElement;
    const transfer = new DataTransfer();
    transfer.items.add(new File(
      ['browser attachment'],
      'deployment-observability-and-reliability-review-notes.txt',
      { type: 'text/plain' },
    ));
    Object.defineProperty(picker, 'files', { configurable: true, value: transfer.files });
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => runtime.querySelector('[data-attachment-status="staged_ready"]') !== null);

    const surface = runtime.querySelector('#redeven-flower-surface') as HTMLElement;
    const composer = runtime.querySelector('.flower-composer') as HTMLElement;
    const lane = runtime.querySelector('.flower-attachment-lane') as HTMLElement;
    const item = runtime.querySelector('.flower-attachment-item') as HTMLElement;
    const actions = runtime.querySelector('.flower-attachment-actions') as HTMLElement;
    expect(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth + 1);
    expect(composer.scrollWidth).toBeLessThanOrEqual(composer.clientWidth + 1);
    expect(lane.scrollWidth).toBeLessThanOrEqual(lane.clientWidth + 1);
    expectHorizontallyContained(item.getBoundingClientRect(), lane.getBoundingClientRect());
    expectHorizontallyContained(actions.getBoundingClientRect(), item.getBoundingClientRect());

    const visibleModelTrigger = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.flower-model-reasoning-model-trigger'))
      .find((button) => !button.closest('.flower-composer-controls-measure') && button.getBoundingClientRect().width > 0);
    await page.viewport(800, 720);
    await waitFor(() => Boolean(visibleModelTrigger()));
    const modelTrigger = visibleModelTrigger();
    expect(modelTrigger).toBeTruthy();
    modelTrigger!.click();
    await waitFor(() => Boolean(document.querySelector('.flower-model-menu-item')));
    await waitFor(() => document.querySelector('.flower-model-menu-attachment-status') === null);
    const menu = document.querySelector('.flower-model-menu') as HTMLElement;
    await waitFor(() => {
      const menuBounds = menu.getBoundingClientRect();
      const surfaceBounds = surface.getBoundingClientRect();
      return menuBounds.left >= surfaceBounds.left - 1 && menuBounds.right <= surfaceBounds.right + 1;
    });
    expectHorizontallyContained(menu.getBoundingClientRect(), surface.getBoundingClientRect());
    expect(menu.scrollWidth).toBeLessThanOrEqual(menu.clientWidth + 1);
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
  });
});
