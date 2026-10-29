import type { FlowerExtensionsAdapter } from '../src/extensions/types';

// Both carriers map the same typed management actions to authenticated Runtime requests.
export function flowerExtensionsAdapter(
  request: <T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<T>,
  access: Pick<FlowerExtensionsAdapter, 'canInteract' | 'canAdmin'>,
): FlowerExtensionsAdapter {
  const skills = '/_redeven_proxy/api/ai/skills';
  const plugins = '/_redeven_proxy/api/ai/agent-plugins';
  const mcp = '/_redeven_proxy/api/ai/mcp';
  return {
    ...access,
    plugins: {
      list: () => request('GET', plugins),
      prepare: input => request('POST', plugins + '/prepare', input),
      operation: id => request('GET', plugins + '/operation?' + new URLSearchParams({ id })),
      commit: input => request('POST', plugins + '/commit', input),
      change: input => request('PUT', plugins, input),
      remove: input => request('DELETE', plugins, input),
      check: input => request('POST', plugins + '/check', input),
      credentials: input => request('PUT', plugins + '/credentials', input),
      addSource: input => request('POST', plugins + '/sources', input),
      removeSource: input => request('DELETE', plugins + '/sources', input),
      catalog: id => request('GET', plugins + '/catalog?' + new URLSearchParams({ id })),
    },
    listSkills: reload => request(reload ? 'POST' : 'GET', reload ? `${skills}/reload` : skills),
    listSkillSources: () => request('GET', `${skills}/sources`),
    toggleSkill: (path, enabled) => request('PUT', `${skills}/toggles`, { patches: [{ path, enabled }] }),
    createSkill: input => request('POST', skills, input),
    deleteSkill: input => request('DELETE', skills, input),
    reinstallSkill: path => request('POST', `${skills}/reinstall`, { paths: [path], overwrite: true }),
    validateSkillImport: input => request('POST', `${skills}/import/github/validate`, input),
    importSkills: input => request('POST', `${skills}/import/github`, input),
    browseSkillTree: (skillPath, dir) => request('GET', `${skills}/browse/tree?${new URLSearchParams({ skill_path: skillPath, dir })}`),
    browseSkillFile: (skillPath, file) => request('GET', `${skills}/browse/file?${new URLSearchParams({ skill_path: skillPath, file })}`),
    listMCP: () => request('GET', mcp),
    saveMCP: input => request('PUT', mcp, input),
    checkMCP: input => request('POST', `${mcp}/check`, input),
    deleteMCP: input => request('DELETE', mcp, input),
  };
}
