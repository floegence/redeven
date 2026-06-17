import { describe, expect, it } from 'vitest';
import { resolveFileMarkdownLink, resolveFileMarkdownLocalPath } from './linkResolver';

describe('file markdown link resolver', () => {
  it('resolves relative document links against the current markdown file directory', () => {
    expect(resolveFileMarkdownLocalPath('CAPABILITY_PERMISSIONS.md', '/workspace/README.md'))
      .toBe('/workspace/CAPABILITY_PERMISSIONS.md');
    expect(resolveFileMarkdownLocalPath('../PERMISSION_POLICY.md#trust', '/workspace/reference/README.md'))
      .toBe('/workspace/PERMISSION_POLICY.md');
  });

  it('classifies heading, external, absolute, and unresolved links', () => {
    expect(resolveFileMarkdownLink('#target-heading', '/workspace/README.md')).toEqual({
      kind: 'heading',
      href: '#target-heading',
      targetId: 'target-heading',
    });

    expect(resolveFileMarkdownLink('https://example.com/help', '/workspace/README.md')).toEqual({
      kind: 'external',
      href: 'https://example.com/help',
    });

    expect(resolveFileMarkdownLink('/workspace/PERMISSION_POLICY.md#trust', '/workspace/README.md')).toEqual({
      kind: 'file',
      href: '/workspace/PERMISSION_POLICY.md#trust',
      path: '/workspace/PERMISSION_POLICY.md',
      fragment: 'trust',
    });

    expect(resolveFileMarkdownLink('PERMISSION_POLICY.md')).toEqual({
      kind: 'unresolved-local',
      href: 'PERMISSION_POLICY.md',
      reason: 'missing_current_file_path',
    });
  });

  it('normalizes dot segments without escaping the filesystem root', () => {
    expect(resolveFileMarkdownLocalPath('../../README.md', '/workspace/reference/security/INDEX.md'))
      .toBe('/workspace/README.md');
    expect(resolveFileMarkdownLocalPath('../../../README.md', '/workspace/reference/security/INDEX.md'))
      .toBe('/README.md');
  });
});
