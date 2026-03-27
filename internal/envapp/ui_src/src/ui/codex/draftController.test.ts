import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';

import {
  CODEX_NEW_THREAD_OWNER,
  codexOwnerIDForThread,
  createCodexDraftController,
} from './draftController';

function withDraftController<T>(callback: (controller: ReturnType<typeof createCodexDraftController>) => T): T {
  let result!: T;
  createRoot((dispose) => {
    try {
      result = callback(createCodexDraftController());
    } finally {
      dispose();
    }
  });
  return result;
}

describe('createCodexDraftController', () => {
  it('preserves new-thread drafts when ownership transfers to a created thread', () => {
    withDraftController((controller) => {
      const threadOwner = codexOwnerIDForThread('thread_new');
      controller.ensureOwner(CODEX_NEW_THREAD_OWNER, { cwd: '/workspace' }, '/workspace');
      controller.setRuntimeField(CODEX_NEW_THREAD_OWNER, 'cwd', '/workspace/ui');
      controller.setRuntimeField(CODEX_NEW_THREAD_OWNER, 'model', 'gpt-5.4');
      controller.setComposerText(CODEX_NEW_THREAD_OWNER, 'Create a new Codex thread');
      controller.appendAttachments(CODEX_NEW_THREAD_OWNER, [{
        id: 'attachment_1',
        name: 'screen.png',
        mime_type: 'image/png',
        size_bytes: 12,
        data_url: 'data:image/png;base64,AAAA',
        preview_url: 'data:image/png;base64,AAAA',
      }]);

      controller.transferOwner(CODEX_NEW_THREAD_OWNER, threadOwner);

      const transferred = controller.draftForOwner(threadOwner, null, '');
      expect(transferred.runtime.cwd).toBe('/workspace/ui');
      expect(transferred.runtime.model).toBe('gpt-5.4');
      expect(transferred.composer.text).toBe('Create a new Codex thread');
      expect(transferred.composer.attachments).toHaveLength(1);
      expect(controller.draftsByOwner()[CODEX_NEW_THREAD_OWNER]).toBeUndefined();
    });
  });

  it('merges bootstrap runtime values without clobbering dirty user overrides', () => {
    withDraftController((controller) => {
      const ownerID = codexOwnerIDForThread('thread_1');
      controller.ensureOwner(ownerID, {
        cwd: '/workspace',
        model: 'gpt-5.4',
        reasoning_effort: 'medium',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
      }, '/workspace');

      controller.setRuntimeField(ownerID, 'cwd', '/workspace/custom');
      controller.setRuntimeField(ownerID, 'approvalPolicy', 'never');

      controller.mergeOwnerRuntimeConfig(ownerID, {
        cwd: '/workspace/server',
        model: 'gpt-5.5',
        reasoning_effort: 'high',
        approval_policy: 'on-request',
        sandbox_mode: 'danger-full-access',
      }, '/workspace/server');

      const draft = controller.draftForOwner(ownerID, null, '');
      expect(draft.runtime.cwd).toBe('/workspace/custom');
      expect(draft.runtime.approvalPolicy).toBe('never');
      expect(draft.runtime.model).toBe('gpt-5.5');
      expect(draft.runtime.effort).toBe('high');
      expect(draft.runtime.sandboxMode).toBe('danger-full-access');
    });
  });

  it('treats same-value updates as no-ops so owner draft references stay stable', () => {
    withDraftController((controller) => {
      const ownerID = codexOwnerIDForThread('thread_1');
      controller.ensureOwner(ownerID, {
        cwd: '/workspace',
        model: 'gpt-5.4',
        reasoning_effort: 'medium',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
      }, '/workspace');

      const before = controller.draftsByOwner()[ownerID];
      controller.mergeOwnerRuntimeConfig(ownerID, {
        cwd: '/workspace',
        model: 'gpt-5.4',
        reasoning_effort: 'medium',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
      }, '/workspace');
      controller.setComposerText(ownerID, '');
      controller.replaceAttachments(ownerID, []);

      expect(controller.draftsByOwner()[ownerID]).toBe(before);
    });
  });
});
