import { describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ capture: vi.fn(), discover: vi.fn() }));
vi.mock('@floegence/redeven-service-templates', async (original) => ({
  ...(await original<typeof import('@floegence/redeven-service-templates')>()),
  captureSource: sdk.capture,
  discoverSources: sdk.discover,
}));
import { DesktopTemplateSources } from './templateSources';

describe('Desktop template source acquisition', () => {
  it('transfers original snapshot bytes without returning the private token', async () => {
    const snapshot = {
      source: { repository: 'owner/repo', ref: 'develop' },
      files: [{ path: 'scripts/start.sh', mode: '100755', content: 'ZXhlYyBhcHAK' }],
      sha256: 'directory-digest',
    };
    sdk.capture.mockResolvedValueOnce(snapshot);
    const sources = new DesktopTemplateSources();
    const result = await sources.acquire(7, {
      operation_id: 'import',
      action: 'capture',
      source: { repository: 'owner/repo' },
      token: 'temporary-private-token',
    });
    expect(result).toEqual({ ok: true, snapshot });
    expect(JSON.stringify(result)).not.toContain('temporary-private-token');
    expect(sdk.capture).toHaveBeenCalledWith(
      { repository: 'owner/repo', ref: undefined, path: undefined },
      'temporary-private-token',
      { signal: expect.any(AbortSignal) },
    );
  });
  it('binds cancellation to its renderer and removes completed operations', async () => {
    let signal: AbortSignal | undefined;
    sdk.capture.mockImplementationOnce(
      (_source, _token, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal = options.signal;
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const sources = new DesktopTemplateSources();
    const operation = sources.acquire(7, {
      operation_id: 'import',
      action: 'capture',
      source: { repository: 'owner/repo' },
    });
    sources.cancel(8, 'import');
    expect(signal?.aborted).toBe(false);
    sources.cancelOwner(7);
    expect(signal?.aborted).toBe(true);
    expect(await operation).toEqual({ ok: false, error_code: 'TEMPLATE_SOURCE_CANCELLED' });
    sdk.capture.mockResolvedValueOnce({ files: [] });
    expect(
      (await sources.acquire(7, { operation_id: 'import', action: 'capture', source: { repository: 'owner/repo' } }))
        .ok,
    ).toBe(true);
  });
  it('rejects malformed input before calling the SDK', async () => {
    const sources = new DesktopTemplateSources();
    const before = sdk.capture.mock.calls.length;
    expect((await sources.acquire(7, { operation_id: '../escape', action: 'capture', token: 'private' })).ok).toBe(
      false,
    );
    expect(sdk.capture.mock.calls.length).toBe(before);
  });
});
