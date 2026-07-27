import { describe, expect, it } from 'vitest';

import {
  RUNTIME_FLOWER_ATTACHMENT_CHUNK_SIZE_BYTES,
  normalizeRuntimeFlowerAttachmentChunkRequest,
  normalizeRuntimeFlowerAttachmentPrepareRequest,
  normalizeRuntimeFlowerAttachmentPreviewRequest,
  normalizeRuntimeFlowerAttachmentProgress,
} from './runtimeFlowerAttachmentIPC';

const digest = 'a'.repeat(64);

describe('runtime Flower attachment IPC', () => {
  it('normalizes a bounded prepare request', () => {
    expect(normalizeRuntimeFlowerAttachmentPrepareRequest({
      operation_id: 'operation-1',
      upload_request_id: 'upload-1',
      staging_scope_id: 'staging-1',
      staging_capability: 'secret-1',
      source: 'long_text',
      display_name: 'notes.txt',
      media_type: 'text/plain; charset=utf-8',
      size_bytes: 12,
      content_sha256: digest.toUpperCase(),
      display_name_sha256: digest,
    })).toEqual({
      operation_id: 'operation-1',
      upload_request_id: 'upload-1',
      staging_scope_id: 'staging-1',
      staging_capability: 'secret-1',
      source: 'long_text',
      display_name: 'notes.txt',
      media_type: 'text/plain; charset=utf-8',
      size_bytes: 12,
      content_sha256: digest,
      display_name_sha256: digest,
    });
  });

  it('rejects invalid digests and oversized chunks', () => {
    expect(normalizeRuntimeFlowerAttachmentPrepareRequest({
      operation_id: 'operation-1', upload_request_id: 'upload-1', staging_scope_id: 'staging-1', staging_capability: 'secret-1', source: 'uploaded_file',
      display_name: 'notes.txt', media_type: 'text/plain', size_bytes: 1,
      content_sha256: 'bad', display_name_sha256: digest,
    })).toBeNull();
    expect(normalizeRuntimeFlowerAttachmentChunkRequest({
      operation_id: 'operation-1', offset_bytes: 0,
      chunk: new Uint8Array(RUNTIME_FLOWER_ATTACHMENT_CHUNK_SIZE_BYTES + 1),
    })).toBeNull();
  });

  it('rejects header injection and non-canonical media type parameters', () => {
    const request = {
      operation_id: 'operation-1', upload_request_id: 'upload-1', staging_scope_id: 'staging-1', staging_capability: 'secret-1', source: 'uploaded_file',
      display_name: 'notes.txt', size_bytes: 1,
      content_sha256: digest, display_name_sha256: digest,
    } as const;
    expect(normalizeRuntimeFlowerAttachmentPrepareRequest({
      ...request,
      media_type: 'text/plain\r\nX-Injected: yes',
    })).toBeNull();
    expect(normalizeRuntimeFlowerAttachmentPrepareRequest({
      ...request,
      media_type: 'text/plain; boundary=unsafe',
    })).toBeNull();
    expect(normalizeRuntimeFlowerAttachmentPrepareRequest({
      ...request,
      display_name: 'notes\u0000.txt',
      media_type: 'text/plain',
    })).toBeNull();
    expect(normalizeRuntimeFlowerAttachmentPrepareRequest({
      ...request,
      display_name: '../notes.txt',
      media_type: 'text/plain',
    })).toBeNull();
  });

  it('requires coherent progress', () => {
    expect(normalizeRuntimeFlowerAttachmentProgress({
      operation_id: 'operation-1', loaded_bytes: 4, total_bytes: 3, state: 'uploading',
    })).toBeNull();
    expect(normalizeRuntimeFlowerAttachmentProgress({
      operation_id: 'operation-1', loaded_bytes: 3, total_bytes: 3, state: 'completed',
    })?.state).toBe('completed');
  });

  it('accepts only owner-audience preview identities and safe display names', () => {
    expect(normalizeRuntimeFlowerAttachmentPreviewRequest({
      attachment_id: 'upl_preview_1',
      staging_scope_id: 'staging-preview-1',
      staging_capability: 'secret-preview-1',
      display_name: 'notes.txt',
    })).toEqual({
      attachment_id: 'upl_preview_1',
      staging_scope_id: 'staging-preview-1',
      staging_capability: 'secret-preview-1',
      display_name: 'notes.txt',
    });
    expect(normalizeRuntimeFlowerAttachmentPreviewRequest({
      attachment_id: 'upl_preview_1', staging_scope_id: 'staging-preview-1', staging_capability: 'secret-preview-1', display_name: '../notes.txt',
    })).toBeNull();
    expect(normalizeRuntimeFlowerAttachmentPreviewRequest({
      attachment_id: 'upl_preview_1', staging_scope_id: '', staging_capability: 'secret-preview-1', display_name: 'notes.txt',
    })).toBeNull();
    expect(normalizeRuntimeFlowerAttachmentPreviewRequest({
      attachment_id: 'upl_preview_1', staging_scope_id: 'staging-preview-1', staging_capability: 'secret\npreview', display_name: 'notes.txt',
    })).toBeNull();
  });
});
