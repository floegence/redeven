import { expect, it } from 'vitest';
import {
  createFlowerComposerDraftCoordinator,
  type FlowerComposerRestartDraft,
} from '../../../../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';
import { loadPluginComposer, savePluginComposer, removePluginComposer, loadPluginComment, savePluginComment, capturePluginDraftsForRestart, restorePluginDraftsAfterRestart } from './pluginComposerPersistence';
import { captureSessionRestartState, restoreSessionRestartState } from '../services/sessionRestart';
it('retains text and attachment bytes across a fresh coordinator without old admission authority', async () => {
  const id = crypto.randomUUID();
  const file = new File(['private attachment'], 'notes.txt', { type: 'text/plain' });
  const value: FlowerComposerRestartDraft = {
    scope_id: 'old-draft',
    value: { text: 'Continue this plugin', mode: 'ordinary', attachments: [], references: [] },
    files: [{ local_id: 'file-1', file }],
  };
  await savePluginComposer(id, value);
  const saved = await loadPluginComposer(id);
  expect(saved?.value.text).toBe(value.value.text);
  expect(await saved?.files[0].file.text()).toBe('private attachment');
  const coordinator = createFlowerComposerDraftCoordinator();
  coordinator.restoreDraft({ ...saved!, scope_id: 'new-session-thread' });
  expect(coordinator.read('new-session-thread').value.text).toBe(value.value.text);
  expect(coordinator.read('new-session-thread').value.client_request_id).toBeUndefined();
  await removePluginComposer(id);
  expect(await loadPluginComposer(id)).toBeUndefined();
  coordinator.dispose();
});
it('rehydrates the origin cache from the bounded Desktop handoff before a later page reload', async () => {
  const id = crypto.randomUUID(), commentOnly = crypto.randomUUID();
  const original = createFlowerComposerDraftCoordinator();
  const restored = createFlowerComposerDraftCoordinator();
  const value: FlowerComposerRestartDraft = {
    scope_id: 'ephemeral-creation-scope', value: { text: 'Keep this unopened draft', mode: 'ordinary', attachments: [], references: [] },
    files: [{ local_id: 'file-1', file: new File(['reference bytes'], 'reference.txt', { type: 'text/plain' }) }],
  };
  try {
    await savePluginComposer(id, value);
    await savePluginComment(id, 'Keep this canvas comment');
    await savePluginComment(commentOnly, 'Independent comment');
    const snapshot = await captureSessionRestartState(original, { viewMode: 'activity', activityID: 'files' });
    await removePluginComposer(id); await removePluginComposer(commentOnly);
    expect(await loadPluginComposer(id)).toBeUndefined();
    await restoreSessionRestartState(restored, snapshot);
    expect((await loadPluginComposer(id))?.value.text).toBe(value.value.text);
    expect(await (await loadPluginComposer(id))?.files[0]?.file.text()).toBe('reference bytes');
    expect(await loadPluginComment(id)).toBe('Keep this canvas comment');
    expect(await loadPluginComment(commentOnly)).toBe('Independent comment');
    const cache = await capturePluginDraftsForRestart();
    await restorePluginDraftsAfterRestart(cache);
    expect((await capturePluginDraftsForRestart()).filter(entry => entry.id === id || entry.id === commentOnly)).toHaveLength(2);
  } finally { await removePluginComposer(id); await removePluginComposer(commentOnly); original.dispose(); restored.dispose(); }
});
it('removes only the deleted project composer and comment together', async () => {
  const id = crypto.randomUUID(), sibling = crypto.randomUUID();
  const value: FlowerComposerRestartDraft = {
    scope_id: 'draft', value: { text: 'Unsent idea', mode: 'ordinary', attachments: [], references: [] }, files: [],
  };
  try {
    await savePluginComposer(id, value);
    await savePluginComment(id, 'Selected element review');
    await savePluginComposer(sibling, value);
    await savePluginComment(sibling, 'Another project review');
    await removePluginComposer(id);
    expect(await loadPluginComposer(id)).toBeUndefined();
    expect(await loadPluginComment(id)).toBeUndefined();
    expect((await loadPluginComposer(sibling))?.value.text).toBe('Unsent idea');
    expect(await loadPluginComment(sibling)).toBe('Another project review');
  } finally { await removePluginComposer(id); await removePluginComposer(sibling); }
});
