import { describe, expect, it } from 'vitest';

import {
  flowerAttachmentStagingHeaders,
  normalizeFlowerAttachmentStagingScope,
} from './flowerAttachmentStaging';

describe('Flower attachment staging host contract', () => {
  it('keeps the bearer capability in headers instead of the scope snapshot', () => {
    const scope = normalizeFlowerAttachmentStagingScope({
      staging_scope_id: 'staging_1',
      target_id: 'client_1',
      expires_at_unix_ms: 1234,
    }, 'secret-value', 'client_1');
    expect(flowerAttachmentStagingHeaders(scope)).toEqual({
      'Upload-Staging-Capability': 'secret-value',
      'Upload-Staging-Scope-ID': 'staging_1',
    });
    expect(JSON.stringify({ ...scope, capability: undefined })).not.toContain('secret-value');
  });

  it('rejects mismatched targets and unsafe capability values', () => {
    expect(() => normalizeFlowerAttachmentStagingScope({
      staging_scope_id: 'staging_1', target_id: 'client_other', expires_at_unix_ms: 1234,
    }, 'secret-value', 'client_1')).toThrow('invalid');
    expect(() => normalizeFlowerAttachmentStagingScope({
      staging_scope_id: 'staging_1', target_id: 'client_1', expires_at_unix_ms: 1234,
    }, 'secret\nvalue', 'client_1')).toThrow('invalid');
  });
});
