import { describe, expect, it } from 'vitest';
import { resolveFileMarkdownLink, resolveFileMarkdownLocalPath } from './linkResolver';

describe('file markdown link resolver', () => {
  it('resolves relative document links against the current markdown file directory', () => {
    expect(resolveFileMarkdownLocalPath('SECURITY_NOTES.md', '/workspace/README.md'))
      .toBe('/workspace/SECURITY_NOTES.md');
    expect(resolveFileMarkdownLocalPath('../ACCESS_POLICY.md#trust', '/workspace/reference/README.md'))
      .toBe('/workspace/ACCESS_POLICY.md');
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

    expect(resolveFileMarkdownLink('/workspace/ACCESS_POLICY.md#trust', '/workspace/README.md')).toEqual({
      kind: 'file',
      href: '/workspace/ACCESS_POLICY.md#trust',
      path: '/workspace/ACCESS_POLICY.md',
      fragment: 'trust',
    });

    expect(resolveFileMarkdownLink('ACCESS_POLICY.md')).toEqual({
      kind: 'unresolved-local',
      href: 'ACCESS_POLICY.md',
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
