import { describe, expect, it } from 'vitest';
import { resolveFileMarkdownLink, resolveFileMarkdownLocalPath } from './linkResolver';

describe('file markdown link resolver', () => {
  it('resolves relative document links against the current markdown file directory', () => {
    expect(resolveFileMarkdownLocalPath('docs/CAPABILITY_PERMISSIONS.md', '/workspace/README.md'))
      .toBe('/workspace/docs/CAPABILITY_PERMISSIONS.md');
    expect(resolveFileMarkdownLocalPath('../PERMISSION_POLICY.md#trust', '/workspace/docs/README.md'))
      .toBe('/workspace/PERMISSION_POLICY.md');
  });

  it('classifies heading, external, absolute, and unresolved links', () => {
    expect(resolveFileMarkdownLink('#target-heading', '/workspace/README.md')).toEqual({
      kind: 'heading',
      href: '#target-heading',
      targetId: 'target-heading',
    });

    expect(resolveFileMarkdownLink('https://example.com/docs', '/workspace/README.md')).toEqual({
      kind: 'external',
      href: 'https://example.com/docs',
    });

    expect(resolveFileMarkdownLink('/workspace/docs/PERMISSION_POLICY.md#trust', '/workspace/README.md')).toEqual({
      kind: 'file',
      href: '/workspace/docs/PERMISSION_POLICY.md#trust',
      path: '/workspace/docs/PERMISSION_POLICY.md',
      fragment: 'trust',
    });

    expect(resolveFileMarkdownLink('docs/PERMISSION_POLICY.md')).toEqual({
      kind: 'unresolved-local',
      href: 'docs/PERMISSION_POLICY.md',
      reason: 'missing_current_file_path',
    });
  });

  it('normalizes dot segments without escaping the filesystem root', () => {
    expect(resolveFileMarkdownLocalPath('../../README.md', '/workspace/docs/security/INDEX.md'))
      .toBe('/workspace/README.md');
    expect(resolveFileMarkdownLocalPath('../../../README.md', '/workspace/docs/security/INDEX.md'))
      .toBe('/README.md');
  });
});
