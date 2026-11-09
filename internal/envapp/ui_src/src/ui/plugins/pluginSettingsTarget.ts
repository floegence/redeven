export type PluginAuthorSettingsTarget = Readonly<{
  kind: 'author_preview'; draftID: string; workspaceID: string; pluginInstanceID?: string;
}>;

/** Workspace selection resolves its current preview; contextual links pin an exact instance. */
export function pluginAuthorSettingsResource(target: Omit<PluginAuthorSettingsTarget, 'kind'>): string {
  return JSON.stringify({ kind: 'author_preview', draftID: target.draftID, workspaceID: target.workspaceID, ...(target.pluginInstanceID ? { pluginInstanceID: target.pluginInstanceID } : {}) });
}

export function parsePluginSettingsResource(resource: string | undefined): PluginAuthorSettingsTarget | undefined {
  if (!resource || resource.length > 2048) return undefined;
  try {
    const value: unknown = JSON.parse(resource);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const target = value as Record<string, unknown>;
    if (target.kind !== 'author_preview' || Object.keys(target).some(key => !['kind', 'draftID', 'workspaceID', 'pluginInstanceID'].includes(key))) return undefined;
    const identifier = (id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= 512 && id === id.trim() && ![...id].some(character => character.codePointAt(0)! < 32 || character.codePointAt(0) === 127);
    if (!identifier(target.draftID) || !identifier(target.workspaceID) || target.pluginInstanceID !== undefined && !identifier(target.pluginInstanceID)) return undefined;
    return target as PluginAuthorSettingsTarget;
  } catch { return undefined; }
}
