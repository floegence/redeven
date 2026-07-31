// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import type {
  FlowerAttachmentCapability,
  FlowerAttachmentStagingScope,
  FlowerAttachmentUploadProgress,
  FlowerStagedAttachment,
} from '../contracts/flowerSurfaceContracts';
import { createFlowerAttachmentController } from './createFlowerAttachmentController';

function capability(overrides: Partial<FlowerAttachmentCapability> = {}): FlowerAttachmentCapability {
  return {
    model_id: 'model-1',
    revision: 'capability-1',
    enabled: true,
    supports_long_text: true,
    max_attachments: 20,
    max_file_size_bytes: 1_000_000,
    max_total_size_bytes: 10_000_000,
    routes: {
      'text/plain': 'tool_read',
      'text/plain; charset=utf-8': 'tool_read',
    },
    ...overrides,
  };
}

const stagingScope: FlowerAttachmentStagingScope = {
  staging_scope_id: 'staging-scope-1',
  target_id: 'thread-1',
  capability: 'scope-capability',
  expires_at_unix_ms: 60_000,
};

function staged(input: Readonly<{ id: string; file: File; source?: 'file' | 'long_text' }>): FlowerStagedAttachment {
  return {
    attachment_id: input.id,
    name: input.file.name,
    mime_type: input.file.type,
    size_bytes: input.file.size,
    digest_sha256: input.id.padEnd(64, 'a'),
    locator: `attachment://v1/${input.id}/${encodeURIComponent(input.file.name)}`,
    source: input.source ?? 'file',
    capability_revision: 'capability-1',
  };
}

describe('createFlowerAttachmentController', () => {
  it('keeps uploads queued until a connection-local staging scope is available', async () => {
    const file = new File(['queued'], 'queued.txt', { type: 'text/plain' });
    const upload = vi.fn(async (input) => staged({ id: 'upl_queued________________', file: input.file }));
    const controller = createFlowerAttachmentController({ capability: capability(), upload });

    controller.addFiles([file], 'file');
    expect(upload).not.toHaveBeenCalled();
    expect(controller.snapshot().items[0]?.status).toBe('queued');

    controller.setStagingScope(stagingScope);
    await controller.waitForIdle();
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ staging_scope: stagingScope }));
    expect(controller.snapshot().items[0]?.status).toBe('staged_ready');
  });

  it('reuploads retained local files when an expired staging scope is replaced', async () => {
    const file = new File(['refresh'], 'refresh.txt', { type: 'text/plain' });
    const refreshedScope: FlowerAttachmentStagingScope = {
      ...stagingScope,
      staging_scope_id: 'staging-scope-2',
      capability: 'scope-capability-2',
    };
    const upload = vi.fn(async (input) => staged({
      id: input.staging_scope.staging_scope_id === stagingScope.staging_scope_id
        ? 'upl_before_refresh________'
        : 'upl_after_refresh_________',
      file: input.file,
    }));
    const controller = createFlowerAttachmentController({ capability: capability(), stagingScope, upload });
    controller.addFiles([file], 'file');
    await controller.waitForIdle();

    controller.setStagingScope(refreshedScope);
    await controller.waitForIdle();

    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ staging_scope: refreshedScope }));
    expect(controller.snapshot().items[0]).toMatchObject({
      status: 'staged_ready',
      staged: { attachment_id: 'upl_after_refresh_________' },
    });
  });

  it('invalidates an in-flight upload when its staging scope is released and refreshes it under the new scope', async () => {
    const file = new File(['refresh in flight'], 'refresh-in-flight.txt', { type: 'text/plain' });
    const refreshedScope: FlowerAttachmentStagingScope = {
      ...stagingScope,
      staging_scope_id: 'staging-scope-refreshed',
      capability: 'scope-capability-refreshed',
    };
    const uploads: Array<(attachment: FlowerStagedAttachment) => void> = [];
    const deleteStaged = vi.fn(async () => undefined);
    const controller = createFlowerAttachmentController({
      capability: capability(),
      stagingScope,
      deleteStaged,
      upload: () => new Promise((resolve) => uploads.push(resolve)),
    });

    controller.addFiles([file], 'file');
    expect(uploads).toHaveLength(1);
    controller.setStagingScope(null);
    expect(controller.snapshot().items[0]?.status).toBe('queued');
    controller.setStagingScope(refreshedScope);
    expect(uploads).toHaveLength(2);

    const stale = staged({ id: 'upl_expired_in_flight_____', file });
    uploads[0]!(stale);
    await vi.waitFor(() => expect(deleteStaged).toHaveBeenCalledWith(stale.attachment_id, stagingScope));
    expect(controller.snapshot().items[0]?.status).toBe('uploading');

    const current = staged({ id: 'upl_refreshed_in_flight___', file });
    uploads[1]!(current);
    await controller.waitForIdle();
    expect(controller.snapshot().items[0]).toMatchObject({
      status: 'staged_ready',
      staged: { attachment_id: current.attachment_id },
    });
  });

  it('runs at most three uploads while preserving item order', async () => {
    const releases: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    const upload = vi.fn(async (input) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return staged({ id: `upl_${input.file.name.padEnd(24, '_')}`, file: input.file });
    });
    const controller = createFlowerAttachmentController({ capability: capability(), stagingScope, upload });
    const files = Array.from({ length: 5 }, (_, index) => new File([`${index}`], `${index}.txt`, { type: 'text/plain' }));

    controller.addFiles(files, 'file');
    expect(upload).toHaveBeenCalledTimes(3);
    expect(controller.snapshot().items.map((item) => item.name)).toEqual(files.map((file) => file.name));

    releases.splice(0, 3).forEach((release) => release());
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(5));
    releases.splice(0).forEach((release) => release());
    await controller.waitForIdle();

    expect(peak).toBe(3);
    expect(controller.snapshot().items.every((item) => item.status === 'staged_ready')).toBe(true);
  });

  it('ignores late progress and deletes a commit that arrives after cancellation', async () => {
    let finishUpload: ((attachment: FlowerStagedAttachment) => void) | undefined;
    let reportProgress: ((loaded: number) => void) | undefined;
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const deleteStaged = vi.fn(async () => undefined);
    const controller = createFlowerAttachmentController({
      capability: capability(),
      stagingScope,
      deleteStaged,
      upload: (input) => new Promise((resolve) => {
        reportProgress = (loaded) => input.on_progress({
          attempt_id: input.attempt_id,
          loaded,
          total: file.size,
          indeterminate: false,
        });
        finishUpload = resolve;
      }),
    });
    const [localID] = controller.addFiles([file], 'file');
    reportProgress?.(2);
    expect(controller.snapshot().items[0]?.loaded_bytes).toBe(2);
    controller.cancel(localID!);
    reportProgress?.(4);
    expect(controller.snapshot().items).toEqual([]);
    finishUpload?.(staged({ id: 'upl_latecommit____________', file }));
    await vi.waitFor(() => expect(deleteStaged).toHaveBeenCalledWith('upl_latecommit____________', stagingScope));
  });

  it('keeps a replacement upload independent from a cancelled attempt', async () => {
    const uploads: Array<(attachment: FlowerStagedAttachment) => void> = [];
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const attachment = staged({ id: 'upl_idempotent____________', file });
    const deleteStaged = vi.fn(async () => undefined);
    const controller = createFlowerAttachmentController({
      capability: capability(),
      stagingScope,
      deleteStaged,
      concurrency: 1,
      upload: () => new Promise((resolve) => uploads.push(resolve)),
    });
    const [localID] = controller.addFiles([file], 'file');
    controller.cancel(localID!);
    controller.addFiles([file], 'file');
    expect(uploads).toHaveLength(2);

    uploads[0]!(attachment);
    await vi.waitFor(() => expect(deleteStaged).toHaveBeenCalledWith(attachment.attachment_id, stagingScope));
    expect(controller.snapshot().items[0]?.status).toBe('uploading');
    const replacement = staged({ id: 'upl_replacement____________', file });
    uploads[1]!(replacement);
    await controller.waitForIdle();

    expect(controller.snapshot().items[0]?.staged?.attachment_id).toBe(replacement.attachment_id);
    expect(deleteStaged).not.toHaveBeenCalledWith(replacement.attachment_id, stagingScope);
  });

  it('cleans a late commit after removal and reconciles deleted shared items', async () => {
    const uploads: Array<(attachment: FlowerStagedAttachment) => void> = [];
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const deleteStaged = vi.fn(async () => undefined);
    const controller = createFlowerAttachmentController({
      capability: capability(),
      stagingScope,
      deleteStaged,
      upload: () => new Promise((resolve) => uploads.push(resolve)),
    });
    const [removedID] = controller.addFiles([file], 'file');
    controller.remove(removedID!);
    uploads[0]!(staged({ id: 'upl_removed_______________', file }));
    await vi.waitFor(() => expect(deleteStaged).toHaveBeenCalledWith('upl_removed_______________', stagingScope));

    const shared = staged({ id: 'upl_shared_reconcile______', file });
    controller.hydrateDraft([{
      local_id: 'local-shared', request_id: 'request-shared', source: 'file',
      name: file.name, mime_type: file.type, size_bytes: file.size, staged: shared,
    }]);
    controller.hydrateDraft([]);
    expect(controller.snapshot().items).toEqual([]);
  });

  it('creates collision-resistant defaults across controllers', () => {
    const first = createFlowerAttachmentController({ capability: capability() });
    const second = createFlowerAttachmentController({ capability: capability() });
    const file = new File(['a'], 'a.txt', { type: 'text/plain' });
    const firstID = first.addFiles([file], 'file')[0];
    const secondID = second.addFiles([file], 'file')[0];
    expect(firstID).toBeTruthy();
    expect(secondID).toBeTruthy();
    expect(firstID).not.toBe(secondID);
  });

  it('preserves deterministic server validation errors without offering retry', async () => {
    const controller = createFlowerAttachmentController({
      capability: capability(),
      stagingScope,
      upload: async () => {
        throw Object.assign(new Error('rejected'), { code: 'attachment_invalid_text_encoding', data: { retryable: false } });
      },
    });
    controller.addFiles([new File(['invalid'], 'invalid.txt', { type: 'text/plain' })], 'file');
    await controller.waitForIdle();
    expect(controller.snapshot().items[0]).toMatchObject({
      status: 'validation_error',
      error_code: 'attachment_invalid_text_encoding',
    });
  });

  it('projects canonical server metadata after upload completion', async () => {
    const file = new File(['client bytes'], 'client-name', { type: '' });
    const upload = vi.fn(async (): Promise<FlowerStagedAttachment> => ({
      attachment_id: 'upl_canonical_____________',
      name: 'canonical-name.txt',
      mime_type: 'text/plain; charset=utf-8',
      size_bytes: 12,
      digest_sha256: 'b'.repeat(64),
      locator: 'attachment://v1/upl_canonical/canonical-name.txt',
      source: 'file',
      text_stats: { code_points: 12, lines: 3 },
      capability_revision: 'capability-1',
    }));
    const controller = createFlowerAttachmentController({ capability: capability(), stagingScope, upload });

    controller.addFiles([file], 'file');
    await controller.waitForIdle();

    expect(controller.snapshot().items[0]).toMatchObject({
      name: 'canonical-name.txt',
      mime_type: 'text/plain; charset=utf-8',
      size_bytes: 12,
      text_stats: { code_points: 12, lines: 3 },
      loaded_bytes: 12,
      total_bytes: 12,
      status: 'staged_ready',
    });
  });

  it('restores exact long text from memory and removes it independently', async () => {
    const upload = vi.fn(async (input) => staged({ id: 'upl_longtext_____________', file: input.file, source: 'long_text' }));
    const deleteStaged = vi.fn(async () => undefined);
    const controller = createFlowerAttachmentController({ capability: capability(), stagingScope, upload, deleteStaged });
    const text = `${'😀'.repeat(50_001)}\r\nexact`;
    const added = controller.addLongText(text);
    expect(added.kind).toBe('accepted');
    if (added.kind !== 'accepted') throw new Error('expected long text to be accepted');
    const localID = added.local_id;
    await controller.waitForIdle();
    await expect(controller.restoreLongText(localID)).resolves.toBe(text);
    controller.remove(localID);
    expect(controller.snapshot().items).toEqual([]);
    expect(deleteStaged).not.toHaveBeenCalled();
  });

  it('rejects long text without creating an attachment when local limits cannot accept it', () => {
    const controller = createFlowerAttachmentController({
      capability: capability({ max_file_size_bytes: 8, max_total_size_bytes: 8 }),
      upload: vi.fn(),
    });

    expect(controller.addLongText('text that is too large')).toEqual({
      kind: 'rejected',
      error_code: 'attachment_too_large',
    });
    expect(controller.snapshot().items).toEqual([]);
  });

  it('hydrates shared staged metadata without reacquiring a local file', () => {
    const file = new File(['shared'], 'shared.txt', { type: 'text/plain' });
    const attachment = staged({ id: 'upl_shared_______________', file });
    const controller = createFlowerAttachmentController({ capability: capability() });

    controller.hydrateDraft([{
      local_id: 'local-shared',
      request_id: 'request-shared',
      source: 'file',
      name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      staged: attachment,
    }]);

    expect(controller.snapshot().items).toEqual([
      expect.objectContaining({
        local_id: 'local-shared',
        status: 'staged_ready',
        staged: attachment,
      }),
    ]);
  });

  it('keeps a live upload intact when the connection-local draft projects back', async () => {
    let finishUpload!: (attachment: FlowerStagedAttachment) => void;
    let reportProgress!: (progress: FlowerAttachmentUploadProgress) => void;
    let uploadAttemptID = '';
    const file = new File(['shared'], 'shared.txt', { type: 'text/plain' });
    const controller = createFlowerAttachmentController({
      capability: capability(),
      stagingScope,
      upload: (input) => {
        uploadAttemptID = input.attempt_id;
        reportProgress = input.on_progress;
        return new Promise((resolve) => { finishUpload = resolve; });
      },
    });
    const [localID] = controller.addFiles([file], 'file');
    const uploading = controller.snapshot().items[0]!;

    controller.hydrateDraft([{
      local_id: localID!,
      request_id: uploading.request_id,
      source: uploading.source,
      name: uploading.name,
      mime_type: uploading.mime_type,
      size_bytes: uploading.size_bytes,
    }]);

    expect(controller.snapshot().items[0]?.status).toBe('uploading');
    reportProgress({ attempt_id: uploadAttemptID, loaded: 3, total: file.size, indeterminate: false });
    expect(controller.snapshot().items[0]?.loaded_bytes).toBe(3);
    finishUpload(staged({ id: 'upl_live_projection________', file }));
    await controller.waitForIdle();
    expect(controller.snapshot().items[0]).toMatchObject({
      status: 'staged_ready',
      staged: { attachment_id: 'upl_live_projection________' },
    });
  });
});
