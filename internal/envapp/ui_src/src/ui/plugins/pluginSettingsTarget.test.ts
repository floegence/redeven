import { expect, it } from 'vitest';
import { parsePluginSettingsResource, parseInstalledPluginSettingsResource, pluginAuthorSettingsResource, pluginInstalledSettingsResource } from './pluginSettingsTarget';

it('round trips exact author workspace and preview instance without installed fallback', () => {
  const target = { draftID: 'draft-1', workspaceID: 'author-1', pluginInstanceID: 'preview-1' };
  expect(parsePluginSettingsResource(pluginAuthorSettingsResource(target))).toEqual({ kind: 'author_preview', ...target });
  expect(parsePluginSettingsResource('instance:preview-1')).toBeUndefined();
});
it('keeps installed connection identities disjoint from author preview identities', () => {
  const resource = pluginInstalledSettingsResource('metrics-instance');
  expect(parseInstalledPluginSettingsResource(resource)).toBe('metrics-instance');
  expect(parsePluginSettingsResource(resource)).toBeUndefined();
  expect(parseInstalledPluginSettingsResource(pluginAuthorSettingsResource({ draftID: 'draft', workspaceID: 'author', pluginInstanceID: 'metrics-instance' }))).toBeUndefined();
  for (const value of ['instance:metrics-instance', '{}', JSON.stringify({ kind: 'installed_connections', pluginInstanceID: ' other' }), JSON.stringify({ kind: 'installed_connections', pluginInstanceID: 'one', extra: 'two' })]) expect(parseInstalledPluginSettingsResource(value)).toBeUndefined();
});
it('supports selecting an existing author workspace before its current preview is read', () => {
  const target = { draftID: 'draft-1', workspaceID: 'author-1' };
  expect(parsePluginSettingsResource(pluginAuthorSettingsResource(target))).toEqual({ kind: 'author_preview', ...target });
});
it.each(['{}', '[]', 'null', '{', JSON.stringify({ kind: 'installed', draftID: 'a', workspaceID: 'b' }), JSON.stringify({ kind: 'author_preview', draftID: '', workspaceID: 'b' }), JSON.stringify({ kind: 'author_preview', draftID: 'a', workspaceID: 'b', pluginInstanceID: 2 }), JSON.stringify({ kind: 'author_preview', draftID: 'a', workspaceID: ' b' }), JSON.stringify({ kind: 'author_preview', draftID: 'a', workspaceID: 'b', extra: 'surprise' })])('rejects malformed targets %s', resource => {
  expect(parsePluginSettingsResource(resource)).toBeUndefined();
});
