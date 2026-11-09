import { describe, expect, it } from 'vitest';
import { buildGitWorkspaceTree } from './gitWorkspaceTreeModel';
describe('Git workspace tree', () => {
  it('retains nested paths and section-aware file identities without flattening names', () => {
    const file = { path: 'src/deep/Long component.test.tsx', section: 'unstaged', changeType: 'modified' };
    const tree = buildGitWorkspaceTree([file, { path: 'README.md', section: 'unstaged' }]);
    expect(tree[0].label).toBe('src');
    expect(tree[0].children[0].children[0].item).toBe(file);
    expect(tree[0].children[0].children[0].label).toBe('Long component.test.tsx');
    expect(tree[1].label).toBe('README.md');
  });
  it('keeps authoritative directory summaries as lazy boundaries and respects scope', () => {
    const item = { entryKind: 'directory', directoryPath: 'src/components', path: 'src/components', section: 'changes', descendantFileCount: 900 };
    const tree = buildGitWorkspaceTree([item], 'src');
    expect(tree).toHaveLength(1);
    expect(tree[0].item).toBe(item);
    expect(tree[0].children).toEqual([]);
    expect(buildGitWorkspaceTree([{ path: 'elsewhere/file.ts' }], 'src')).toEqual([]);
  });
});
