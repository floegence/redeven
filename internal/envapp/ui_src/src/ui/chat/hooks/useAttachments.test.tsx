// @vitest-environment jsdom

import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAttachments, type UseAttachmentsReturn } from './useAttachments';

function createAttachmentHarness(
  onUpload?: (file: File) => Promise<string>,
): { api: UseAttachmentsReturn; dispose: () => void } {
  let api!: UseAttachmentsReturn;
  let dispose = () => {};

  createRoot((rootDispose) => {
    dispose = rootDispose;
    api = useAttachments({
      uploadMode: 'deferred',
      onUpload,
    });
  });

  return { api, dispose };
}

describe('useAttachments', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('re-uploads attachments that were marked uploaded without a usable url', async () => {
    const onUpload = vi.fn(async () => '/_redeven_proxy/api/ai/uploads/upl_retry');
    const { api, dispose } = createAttachmentHarness(onUpload);

    try {
      const file = new File(['demo'], 'demo.txt', { type: 'text/plain' });
      api.addFiles([file]);

      const [initial] = api.attachments();
      api.replaceAttachments([
        {
          ...initial,
          status: 'uploaded',
          url: '   ',
          error: 'stale upload state',
        },
      ]);

      const result = await api.uploadAll();
      const [finalAttachment] = api.attachments();

      expect(onUpload).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
      expect(finalAttachment.status).toBe('uploaded');
      expect(finalAttachment.url).toBe('/_redeven_proxy/api/ai/uploads/upl_retry');
      expect(finalAttachment.error).toBeUndefined();
    } finally {
      dispose();
    }
  });

  it('keeps the attachment in error state when upload fails', async () => {
    const onUpload = vi.fn(async () => {
      throw new Error('upload denied');
    });
    const { api, dispose } = createAttachmentHarness(onUpload);

    try {
      const file = new File(['demo'], 'demo.txt', { type: 'text/plain' });
      api.addFiles([file]);

      const result = await api.uploadAll();
      const [finalAttachment] = api.attachments();

      expect(onUpload).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(false);
      expect(result.failed).toHaveLength(1);
      expect(finalAttachment.status).toBe('error');
      expect(finalAttachment.error).toBe('upload denied');
    } finally {
      dispose();
    }
  });
});
