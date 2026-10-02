import { describe, expect, it } from 'vitest';
import { normalizeFilesystemScopeDraft } from './filesystemScopeSettings';

describe('filesystem scope settings helpers', () => {
  it('normalizes missing runtime scope into read/write Home and Computer roots', () => {
    const scope = normalizeFilesystemScopeDraft('/Users/alice', null);

    expect(scope).toEqual({
      schema_version: 1,
      default_root_id: 'home',
      roots: [
        {
          id: 'home',
          label: 'Home',
          path: '/Users/alice',
          kind: 'home',
          permissions: { read: true, write: true },
          hidden: false,
          system: true,
        },
        {
          id: 'computer',
          label: 'Computer',
          path: '/',
          kind: 'computer',
          permissions: { read: true, write: true },
          hidden: false,
          system: true,
        },
      ],
    });
  });

  it('preserves explicitly configured read-only roots', () => {
    const source = normalizeFilesystemScopeDraft('/Users/alice', {
      schema_version: 1,
      default_root_id: 'home',
      roots: [
        {
          id: 'home',
          label: 'Home',
          path: '/Users/alice',
          kind: 'home',
          permissions: { read: true, write: true },
          system: true,
        },
        {
          id: 'computer',
          label: 'Computer',
          path: '/',
          kind: 'computer',
          permissions: { read: true, write: false },
          system: true,
        },
      ],
    });

    const next = normalizeFilesystemScopeDraft('/Users/alice', source);

    expect(source.roots.find((root) => root.id === 'computer')?.permissions.write).toBe(false);
    expect(next.roots.find((root) => root.id === 'computer')?.permissions).toEqual({ read: true, write: false });
    expect(next).toEqual(source);
    expect(next.roots[1]).not.toBe(source.roots[1]);
  });
});
