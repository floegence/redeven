import { Buffer } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

import type { RuntimeFlowerHTTPResponse } from './runtimeFlowerHTTP';
import {
  materializeRuntimeFlowerAttachmentPreview,
  requestRuntimeFlowerAttachmentPreviewWithAccess,
  RUNTIME_FLOWER_ATTACHMENT_PREVIEW_MAX_BYTES,
  RUNTIME_FLOWER_ATTACHMENT_PREVIEW_RETENTION_MS,
  runtimeFlowerAttachmentPreviewFilename,
  type RuntimeFlowerAttachmentPreviewFileSystem,
} from './runtimeFlowerAttachmentPreview';

function response(status: number): RuntimeFlowerHTTPResponse {
  return { status, body: '', bytes: Buffer.alloc(0), headers: {} };
}

function fileSystem(overrides: Partial<RuntimeFlowerAttachmentPreviewFileSystem> = {}) {
  return {
    createDirectory: vi.fn(async () => '/tmp/redeven-flower-preview-test'),
    writeExclusive: vi.fn(async () => undefined),
    removeDirectory: vi.fn(async () => undefined),
    openPath: vi.fn(async () => ''),
    scheduleCleanup: vi.fn(),
    ...overrides,
  } satisfies RuntimeFlowerAttachmentPreviewFileSystem;
}

describe('runtime Flower attachment preview', () => {
  it('invalidates expired access and retries exactly once after refresh', async () => {
    const request = vi.fn().mockResolvedValueOnce(response(423)).mockResolvedValueOnce(response(200));
    const invalidateAccess = vi.fn();
    const refreshAccess = vi.fn(async () => undefined);

    await expect(requestRuntimeFlowerAttachmentPreviewWithAccess({
      request, invalidateAccess, refreshAccess,
    })).resolves.toMatchObject({ status: 200 });

    expect(request).toHaveBeenCalledTimes(2);
    expect(invalidateAccess).toHaveBeenCalledOnce();
    expect(refreshAccess).toHaveBeenCalledOnce();
  });

  it('rejects more than 10 MiB without creating a temporary directory', async () => {
    const fs = fileSystem();
    await expect(materializeRuntimeFlowerAttachmentPreview({
      bytes: Buffer.alloc(RUNTIME_FLOWER_ATTACHMENT_PREVIEW_MAX_BYTES + 1),
      contentType: 'application/pdf', tempRoot: '/tmp', fileSystem: fs,
    })).rejects.toThrow('too large');
    expect(fs.createDirectory).not.toHaveBeenCalled();
  });

  it.each([
    ['write failure', { writeExclusive: vi.fn(async () => { throw new Error('disk full'); }) }],
    ['openPath failure', { openPath: vi.fn(async () => 'no application') }],
  ])('removes temporary data after %s', async (_label, overrides) => {
    const fs = fileSystem(overrides);
    await expect(materializeRuntimeFlowerAttachmentPreview({
      bytes: Buffer.from('preview'), contentType: 'text/plain', tempRoot: '/tmp', fileSystem: fs,
    })).rejects.toThrow();
    expect(fs.removeDirectory).toHaveBeenCalledWith('/tmp/redeven-flower-preview-test');
    expect(fs.scheduleCleanup).not.toHaveBeenCalled();
  });

  it('writes exclusively, opens the safe path, and schedules successful cleanup', async () => {
    const fs = fileSystem();
    await materializeRuntimeFlowerAttachmentPreview({
      bytes: Buffer.from('preview'), contentType: 'text/plain; charset=utf-8', tempRoot: '/tmp', fileSystem: fs,
    });

    const expectedPath = '/tmp/redeven-flower-preview-test/attachment-preview.txt';
    expect(runtimeFlowerAttachmentPreviewFilename('text/plain')).toBe('attachment-preview.txt');
    expect(fs.writeExclusive).toHaveBeenCalledWith(expectedPath, Buffer.from('preview'));
    expect(fs.openPath).toHaveBeenCalledWith(expectedPath);
    expect(fs.scheduleCleanup).toHaveBeenCalledWith(expect.any(Function), RUNTIME_FLOWER_ATTACHMENT_PREVIEW_RETENTION_MS);
    const cleanup = vi.mocked(fs.scheduleCleanup).mock.calls[0]?.[0];
    cleanup?.();
    expect(fs.removeDirectory).toHaveBeenCalledWith('/tmp/redeven-flower-preview-test');
  });

  it.each([
    ['text/html', '<script>active()</script>'],
    ['image/svg+xml', '<svg onload="active()"/>'],
    [undefined, '<script>missing content type</script>'],
  ])('rejects non-canonical %s content without materializing an active suffix', async (contentType, body) => {
    const fs = fileSystem();
    await expect(materializeRuntimeFlowerAttachmentPreview({
      bytes: Buffer.from(body), contentType, tempRoot: '/tmp', fileSystem: fs,
    })).rejects.toThrow('unsupported attachment preview content type');
    expect(fs.createDirectory).not.toHaveBeenCalled();
    expect(fs.writeExclusive).not.toHaveBeenCalled();
    expect(fs.openPath).not.toHaveBeenCalled();
  });

  it.each([
    ['application/pdf', 'attachment-preview.pdf'],
    ['image/png', 'attachment-preview.png'],
    ['image/jpeg', 'attachment-preview.jpg'],
    ['image/gif', 'attachment-preview.gif'],
    ['image/webp', 'attachment-preview.webp'],
  ])('uses the canonical response type %s for the preview extension', (contentType, filename) => {
    expect(runtimeFlowerAttachmentPreviewFilename(contentType)).toBe(filename);
  });
});
