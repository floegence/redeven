// @vitest-environment jsdom

import { File as NodeFile } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFlowerAttachmentController } from '../../../../../flower_ui/src/attachments/createFlowerAttachmentController';
import { createFlowerComposerDraftCoordinator } from '../../../../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';
import { captureSessionRestartState, restoreSessionRestartState } from './sessionRestart';

describe('Env App restart state', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('restores the frozen page reference and the once-only marker after removal', async () => {
    const original = createFlowerComposerDraftCoordinator();
    original.open('pending').mutate(value => ({ ...value, page_context_captured: true,
      references: [{ kind: 'page_context', local_id: 'page-ref', label: 'Monitor', title: 'Monitor', content: 'frozen page' }] }));
    original.open('removed').mutate(value => ({ ...value, page_context_captured: true }));
    const state = await captureSessionRestartState(original, { viewMode: 'activity', activityID: 'files' });
    const restored = createFlowerComposerDraftCoordinator();
    restoreSessionRestartState(restored, state);
    expect(restored.read('pending').value.references).toEqual(original.read('pending').value.references);
    expect(restored.read('removed').value).toMatchObject({ page_context_captured: true, references: [] });
    original.dispose();
    restored.dispose();
  });

  it('restores workspace choice, multiple drafts and attachment bytes without old request authority', async () => {
    vi.stubGlobal('File', NodeFile);
    const original = createFlowerComposerDraftCoordinator();
    const file = new File(['attachment contents'], 'note.txt', { type: 'text/plain' });
    const attachment = createFlowerAttachmentController({});
    const [localID] = attachment.addFiles([file], 'file');
    original.open('thread-one').mutate(value => ({ ...value, text: 'a'.repeat(40000),
      model_id: 'chosen-model', working_dir: '/workspace', client_request_id: 'old-request',
      attachments: [{ local_id: localID!, source: 'file', name: file.name, mime_type: file.type,
        size_bytes: file.size, upload_request_id: 'old-upload', attempt_state: 'queued' }],
    }));
    original.attachmentController('thread-one', () => attachment);
    original.open('thread-two').mutate(value => ({ ...value, text: 'another draft',
      references: [{ local_id: 'ref', kind: 'file', path: '/workspace/note.txt', label: 'note.txt' }],
    }));

    const state = await captureSessionRestartState(original, { viewMode: 'workbench', activityID: 'flower' });
    expect(state.files).toHaveLength(1);
    expect(Array.from(state.files[0]?.bytes ?? [])).toEqual(Array.from(new TextEncoder().encode('attachment contents')));
    expect(state.json).not.toContain('old-request');
    expect(state.json).not.toContain('old-upload');

    const restored = createFlowerComposerDraftCoordinator();
    expect(restoreSessionRestartState(restored, state)).toEqual({ viewMode: 'workbench', activityID: 'flower' });
    const restoredAttachment = restored.attachmentController('thread-one', () => createFlowerAttachmentController({}));
    expect(restored.read('thread-one').value.text).toHaveLength(40000);
    expect(restored.read('thread-one').value.model_id).toBe('chosen-model');
    expect(restored.read('thread-two').value.references[0]).toMatchObject({ kind: 'file', path: '/workspace/note.txt' });
    expect(await restoredAttachment.localFiles()[0]?.file.text()).toBe('attachment contents');
    original.dispose();
    restored.dispose();
  });
});
