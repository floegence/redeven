import { expect, it } from 'vitest';
import {
  createFlowerComposerDraftCoordinator,
  type FlowerComposerRestartDraft,
} from '../../../../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';
import { loadPluginComposer, savePluginComposer, removePluginComposer } from './pluginComposerPersistence';
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
