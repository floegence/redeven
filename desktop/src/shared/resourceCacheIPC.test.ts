import { describe, expect, it } from 'vitest';
import { normalizeResourceCacheRequest } from './resourceCacheIPC';

describe('resource cache IPC boundary', () => {
  it('accepts only bounded serialized payloads and never accepts renderer-selected owners', () => {
    expect(normalizeResourceCacheRequest({ action: 'set', key: 'snapshot', value: '[]', owner: 'another-account' })).toEqual({ action: 'set', key: 'snapshot', value: '[]' });
    expect(normalizeResourceCacheRequest({ action: 'list', owner: 'another-account' })).toEqual({ action: 'list' });
    expect(normalizeResourceCacheRequest({ action: 'set', key: 'snapshot', value: {} })).toBeNull();
    expect(normalizeResourceCacheRequest({ action: 'set', key: 'snapshot', value: 'x'.repeat(32 * 1024 * 1024 + 1) })).toBeNull();
    expect(normalizeResourceCacheRequest({ action: 'get', key: 'x'.repeat(8193) })).toBeNull();
    expect(normalizeResourceCacheRequest({ action: 'remove', key: '' })).toBeNull();
    expect(normalizeResourceCacheRequest({ action: 'execute', key: 'snapshot' })).toBeNull();
  });
});
