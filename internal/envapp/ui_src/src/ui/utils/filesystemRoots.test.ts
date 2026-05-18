import { describe, expect, it } from 'vitest';

import {
  defaultFilesystemPath,
  formatFilesystemPath,
  matchFilesystemRoot,
  normalizeFilesystemContext,
  parseFilesystemPathInput,
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

  it('formats home-relative labels without hiding the real OS root', () => {
    expect(formatFilesystemPath('/Users/alice/project', ctx.homePathAbs)).toBe('~/project');
    expect(formatFilesystemPath('/', ctx.homePathAbs)).toBe('/');
  });

  it('parses tilde and absolute inputs', () => {
    expect(parseFilesystemPathInput('~/Desktop', ctx.homePathAbs)).toBe('/Users/alice/Desktop');
    expect(parseFilesystemPathInput('/var', ctx.homePathAbs)).toBe('/var');
  });
});

