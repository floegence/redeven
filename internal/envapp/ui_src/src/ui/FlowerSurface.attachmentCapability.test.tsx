// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type { FlowerAttachmentCapability, FlowerAttachmentUploadInput, FlowerSettingsSnapshot } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, deferred, renderSurfaceWithAdapter, settingsSnapshot, waitFor } from './FlowerSurface.navigation.testHarness';

const modelID = 'deepseek/deepseek-flash';
const capability: FlowerAttachmentCapability = {
  model_id: modelID, revision: 'flash-images', enabled: true, supports_long_text: true,
  max_attachments: 10, max_file_size_bytes: 10_000_000, max_total_size_bytes: 25_000_000,
  routes: { 'image/png': 'native_full_content' },
};
const flashSettings = (): FlowerSettingsSnapshot => ({ ...settingsSnapshot(true),
  model_profile: { schema_version: 1, current_model_id: modelID, providers: [{
    id: 'deepseek', name: 'DeepSeek', type: 'deepseek' as const,
    models: [{ model_name: 'deepseek-flash', display_name: 'DeepSeek V4.1 Flash', input_modalities: ['text', 'image'] }],
  }] },
  provider_secrets: [{ provider_id: 'deepseek', provider_api_key_configured: true, web_search_api_key_configured: false }],
});
const uploadImage = async (input: FlowerAttachmentUploadInput) => ({
  attachment_id: 'upl_flash_image', name: input.file.name, mime_type: input.file.type,
  size_bytes: input.file.size, digest_sha256: 'a'.repeat(64), locator: 'attachment://v1/upl_flash_image/image.png',
  source: input.source, capability_revision: input.capability_revision,
});
function pickImage(runtime: HTMLElement) {
  const picker = runtime.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(picker, 'files', { configurable: true, value: [new File(['image'], 'image.png', { type: 'image/png' })] });
  picker.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('Flower attachment capability loading', () => {
  it('retains a picked image while the selected model capability is refreshing', async () => {
    const pending = deferred<FlowerAttachmentCapability>();
    const loadAttachmentCapability = vi.fn(() => pending.promise);
    const uploadAttachment = vi.fn(uploadImage);
    const runtime = renderSurfaceWithAdapter({ ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadSettings: vi.fn(async () => flashSettings()),
      loadAttachmentCapability, uploadAttachment,
    });
    await waitFor(() => loadAttachmentCapability.mock.calls.length > 0);
    pickImage(runtime);
    expect(runtime.querySelector('[data-attachment-status="validation_error"]')).toBeNull();
    expect(uploadAttachment).not.toHaveBeenCalled();
    pending.resolve(capability);
    await waitFor(() => Boolean(runtime.querySelector('[data-attachment-status="staged_ready"]')));
    expect(uploadAttachment).toHaveBeenCalledOnce();
    expect(uploadAttachment.mock.calls[0][0].model_id).toBe(modelID);
  });

  it.each(['failed', 'wrong_model'] as const)('lets users retry retained images after a %s capability read', async (failure) => {
    const pending = deferred<FlowerAttachmentCapability>();
    const loadAttachmentCapability = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(capability);
    const uploadAttachment = vi.fn(uploadImage);
    const runtime = renderSurfaceWithAdapter({ ...adapter(true),
      listThreads: vi.fn(async () => []), loadSettings: vi.fn(async () => flashSettings()),
      loadAttachmentCapability, uploadAttachment,
    });
    await waitFor(() => loadAttachmentCapability.mock.calls.length > 0);
    pickImage(runtime);
    if (failure === 'failed') pending.reject(new Error('Network unavailable'));
    else pending.resolve({ ...capability, model_id: 'different/model' });
    await waitFor(() => Boolean(runtime.querySelector('[data-attachment-status="upload_error"]')));
    expect(runtime.querySelector('.flower-attachment-error')?.textContent).not.toContain('selected model');
    expect(uploadAttachment).not.toHaveBeenCalled();
    runtime.querySelector<HTMLButtonElement>('button[aria-label="Retry upload"]')!.click();
    await waitFor(() => Boolean(runtime.querySelector('[data-attachment-status="staged_ready"]')));
    expect(uploadAttachment).toHaveBeenCalledOnce();
    expect(uploadAttachment.mock.calls[0][0].model_id).toBe(modelID);
  });
});
