import { describe, expect, it, vi } from 'vitest';
import { stageFlowerTurnLauncherAttachments } from './stageFlowerTurnLauncherAttachments';
import type { FlowerAttachmentCapability, FlowerAttachmentUploadInput, FlowerTurnLaunchInput } from './contracts/flowerSurfaceContracts';

const copy = { errorUnavailable: 'Unavailable', errorTooLarge: 'Too large', errorCountExceeded: 'Too many', errorTotalSizeExceeded: 'Total too large', errorUnsupported: 'Unsupported', errorInvalidEncoding: 'Invalid encoding', errorUploadFailed: 'Upload failed', restoreFailed: 'Restore failed' };
const prepared: FlowerTurnLaunchInput = { client_request_id: 'request-1', prompt: '', model_id: 'chosen/model' };
function source(overrides: Partial<FlowerAttachmentCapability> = {}) {
  const scope = { staging_scope_id: 'scope-1', target_id: 'request-1', capability: 'secret', expires_at_unix_ms: 60000 };
  return {
    loadAttachmentCapability: vi.fn(async (model_id: string) => ({ model_id, revision: 'v1', enabled: true, supports_long_text: true, max_attachments: 3, max_file_size_bytes: 100, max_total_size_bytes: 200, routes: {}, ...overrides })),
    createAttachmentStagingScope: vi.fn(async () => scope),
    releaseAttachmentStagingScope: vi.fn(async () => {}),
    uploadAttachment: vi.fn(async (input: FlowerAttachmentUploadInput) => ({ attachment_id: input.file.name, name: input.file.name, mime_type: input.file.type, size_bytes: input.file.size, digest_sha256: 'a'.repeat(64), locator: `attachment://v1/${input.file.name}`, source: 'file' as const, capability_revision: 'v1' })),
  };
}
describe('launcher attachment staging', () => {
  it('does no capability or upload work for a text-only request', async () => {
    const adapter = source(); expect(await stageFlowerTurnLauncherAttachments(adapter, prepared, [], copy)).toBe(prepared);
    expect(adapter.loadAttachmentCapability).not.toHaveBeenCalled();
  });
  it('uses the captured model and request identity while retaining file order', async () => {
    const adapter = source();
    const files = ['first.txt', 'second.txt'].map(name => new File(['hello'], name, { type: 'text/plain' }));
    const result = await stageFlowerTurnLauncherAttachments(adapter, prepared, files, copy);
    expect(adapter.loadAttachmentCapability).toHaveBeenCalledWith('chosen/model');
    expect(adapter.createAttachmentStagingScope).toHaveBeenCalledWith('request-1');
    expect(adapter.uploadAttachment).toHaveBeenCalledTimes(2);
    expect(adapter.uploadAttachment.mock.calls.every(([input]) => input.model_id === 'chosen/model')).toBe(true);
    expect(result).toMatchObject({ ...prepared, attachment_ids: ['first.txt', 'second.txt'], staging_scope: { target_id: 'request-1' } });
    expect(adapter.releaseAttachmentStagingScope).not.toHaveBeenCalled();
  });
  it('targets an existing conversation when supplied', async () => {
    const adapter = source(); await stageFlowerTurnLauncherAttachments(adapter, { ...prepared, thread_id: 'thread-1' }, [new File(['x'], 'x.txt')], copy);
    expect(adapter.createAttachmentStagingScope).toHaveBeenCalledWith('thread-1');
  });
  it.each([
    [{ max_file_size_bytes: 2 }, ['large'], 'Too large'],
    [{ max_attachments: 1 }, ['one', 'two'], 'Too many'],
    [{ max_total_size_bytes: 5 }, ['one', 'two'], 'Total too large'],
  ] as const)('validates all files before creating a scope: %j', async (limits, contents, message) => {
    const adapter = source(limits);
    await expect(stageFlowerTurnLauncherAttachments(adapter, prepared, contents.map((text, i) => new File([text], `${i}.txt`)), copy)).rejects.toThrow(message);
    expect(adapter.createAttachmentStagingScope).not.toHaveBeenCalled(); expect(adapter.uploadAttachment).not.toHaveBeenCalled();
  });
  it('releases partially uploaded files and preserves the upload error', async () => {
    const adapter = source(); adapter.uploadAttachment.mockRejectedValueOnce(new Error('network')); adapter.releaseAttachmentStagingScope.mockRejectedValueOnce(new Error('cleanup'));
    await expect(stageFlowerTurnLauncherAttachments(adapter, prepared, [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')], copy)).rejects.toThrow('Upload failed');
    expect(adapter.releaseAttachmentStagingScope).toHaveBeenCalledOnce();
  });
  it('rejects a different model capability without uploading', async () => {
    const adapter = source({ model_id: 'other/model' });
    await expect(stageFlowerTurnLauncherAttachments(adapter, prepared, [new File(['a'], 'a.txt')], copy)).rejects.toThrow('Unavailable');
    expect(adapter.createAttachmentStagingScope).not.toHaveBeenCalled();
  });
});
