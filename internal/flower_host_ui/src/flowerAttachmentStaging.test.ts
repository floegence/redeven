import { describe, expect, it, vi } from 'vitest';

import {
  createFlowerClientThreadID,
  flowerAttachmentStagingHeaders,
  normalizeFlowerAttachmentStagingScope,
} from './flowerAttachmentStaging';

describe('Flower attachment staging host contract', () => {
  it('creates a server-compatible random thread identity', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) });
    expect(createFlowerClientThreadID()).toMatch(/^th_[A-Za-z0-9_-]{24}$/u);
    vi.unstubAllGlobals();
  });

  it('keeps the bearer capability in headers instead of the scope snapshot', () => {
    const scope = normalizeFlowerAttachmentStagingScope({
      staging_scope_id: 'staging_1',
      thread_id: 'th_1',
      expires_at_unix_ms: 1234,
    }, 'secret-value', 'th_1');
    expect(flowerAttachmentStagingHeaders(scope)).toEqual({
      'Upload-Staging-Capability': 'secret-value',
      'Upload-Staging-Scope-ID': 'staging_1',
    });
    expect(JSON.stringify({ ...scope, capability: undefined })).not.toContain('secret-value');
  });

  it('rejects mismatched targets and unsafe capability values', () => {
    expect(() => normalizeFlowerAttachmentStagingScope({
      staging_scope_id: 'staging_1', thread_id: 'th_other', expires_at_unix_ms: 1234,
    }, 'secret-value', 'th_1')).toThrow('invalid');
    expect(() => normalizeFlowerAttachmentStagingScope({
      staging_scope_id: 'staging_1', thread_id: 'th_1', expires_at_unix_ms: 1234,
    }, 'secret\nvalue', 'th_1')).toThrow('invalid');
  });
});
