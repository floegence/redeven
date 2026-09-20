import { describe, expect, it } from 'vitest';

import {
  defaultFilesystemPath,
  matchFilesystemRoot,
  normalizeFilesystemContext,
  hasHiddenFilesystemPathSegment,
} from './filesystemRoots';

describe('filesystemRoots', () => {
  const ctx = normalizeFilesystemContext({
    agentHomePathAbs: '/Users/alice',
    homePathAbs: '/Users/alice',
    defaultRootId: 'home',
    roots: [
      { id: 'computer', label: 'Computer', pathAbs: '/', kind: 'computer', permissions: { read: true, write: false } },
      { id: 'home', label: 'Home', pathAbs: '/Users/alice', kind: 'home', permissions: { read: true, write: true } },
      { id: 'project', label: 'Project', pathAbs: '/Users/alice/project', kind: 'custom', permissions: { read: true, write: true } },
    ],
  });

  it('selects the configured default root', () => {
    expect(defaultFilesystemPath(ctx)).toBe('/Users/alice');
  });

  it('matches the longest containing root', () => {
    expect(matchFilesystemRoot('/Users/alice/project/src', ctx.roots)?.id).toBe('project');
    expect(matchFilesystemRoot('/etc', ctx.roots)?.id).toBe('computer');
  });

  it('detects hidden segments within the matching filesystem root', () => {
    expect(hasHiddenFilesystemPathSegment('/Users/alice/.config/redeven', ctx.homePathAbs, ctx.roots)).toBe(true);
    expect(hasHiddenFilesystemPathSegment('/Volumes/team/.config', ctx.homePathAbs, ctx.roots)).toBe(true);
    expect(hasHiddenFilesystemPathSegment('/Users/alice/project/src', ctx.homePathAbs, ctx.roots)).toBe(false);
    expect(hasHiddenFilesystemPathSegment('/outside/.config', ctx.homePathAbs)).toBe(false);
    expect(hasHiddenFilesystemPathSegment('/Users/alice/.config/redeven', ctx.homePathAbs)).toBe(true);
    expect(hasHiddenFilesystemPathSegment('/Users/alice', ctx.homePathAbs, ctx.roots)).toBe(false);
  });

  it('does not treat hidden segments in a custom root itself as hidden contents', () => {
    const roots = [...ctx.roots, { ...ctx.roots[0]!, id: 'hidden-project', pathAbs: '/srv/.project' }];
    expect(hasHiddenFilesystemPathSegment('/srv/.project/src', ctx.homePathAbs, roots)).toBe(false);
    expect(hasHiddenFilesystemPathSegment('/srv/.project/.git', ctx.homePathAbs, roots)).toBe(true);
  });
});
