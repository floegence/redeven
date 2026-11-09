import { expect, it } from 'vitest';
import { parsePluginSettingsResource, pluginAuthorSettingsResource } from './pluginSettingsTarget';

it('round trips exact author workspace and preview instance without installed fallback', () => {
  const target = { draftID: 'draft-1', workspaceID: 'author-1', pluginInstanceID: 'preview-1' };
  expect(parsePluginSettingsResource(pluginAuthorSettingsResource(target))).toEqual({ kind: 'author_preview', ...target });
  expect(parsePluginSettingsResource('instance:preview-1')).toBeUndefined();
});
it('supports selecting an existing author workspace before its current preview is read', () => {
  const target = { draftID: 'draft-1', workspaceID: 'author-1' };
  expect(parsePluginSettingsResource(pluginAuthorSettingsResource(target))).toEqual({ kind: 'author_preview', ...target });
});
it.each(['{}', '[]', 'null', '{', JSON.stringify({ kind: 'installed', draftID: 'a', workspaceID: 'b' }), JSON.stringify({ kind: 'author_preview', draftID: '', workspaceID: 'b' }), JSON.stringify({ kind: 'author_preview', draftID: 'a', workspaceID: 'b', pluginInstanceID: 2 }), JSON.stringify({ kind: 'author_preview', draftID: 'a', workspaceID: ' b' }), JSON.stringify({ kind: 'author_preview', draftID: 'a', workspaceID: 'b', extra: 'surprise' })])('rejects malformed targets %s', resource => {
  expect(parsePluginSettingsResource(resource)).toBeUndefined();
});
