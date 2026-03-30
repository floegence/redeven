import { describe, expect, it } from 'vitest';

import {
  basenameFromMarkdownPath,
  buildMarkdownFileReferencePrefixMap,
  parseMarkdownFileReference,
  parseMarkdownLocalFileHref,
} from './markdownFileReference';

describe('parseMarkdownFileReference', () => {
  it('parses multiline file reference labels from local file links', () => {
    const reference = parseMarkdownFileReference(
      '/Users/tangjianyin/Downloads/code/redeven/internal/envapp/ui_src/src/ui/services/controlplaneApi.ts#L278',
      'controlplaneApi.ts\nL278',
    );

    expect(reference).toEqual({
      href: '/Users/tangjianyin/Downloads/code/redeven/internal/envapp/ui_src/src/ui/services/controlplaneApi.ts#L278',
      path: '/Users/tangjianyin/Downloads/code/redeven/internal/envapp/ui_src/src/ui/services/controlplaneApi.ts',
      displayName: 'controlplaneApi.ts',
      lineLabel: 'L278',
      title: '/Users/tangjianyin/Downloads/code/redeven/internal/envapp/ui_src/src/ui/services/controlplaneApi.ts#L278',
    });
  });

  it('parses hash-style line labels from local file links', () => {
    const reference = parseMarkdownFileReference(
      '/Users/tangjianyin/Downloads/code/redeven/docs/CODEX_UI.md#L121',
      'CODEX_UI.md#L121',
    );

    expect(reference).toEqual({
      href: '/Users/tangjianyin/Downloads/code/redeven/docs/CODEX_UI.md#L121',
      path: '/Users/tangjianyin/Downloads/code/redeven/docs/CODEX_UI.md',
      displayName: 'CODEX_UI.md',
      lineLabel: 'L121',
      title: '/Users/tangjianyin/Downloads/code/redeven/docs/CODEX_UI.md#L121',
    });
  });

  it('ignores non-file web links', () => {
    expect(parseMarkdownFileReference(
      'https://bugs.webkit.org/show_bug.cgi?id=298616',
      'Bug 298616',
    )).toBeNull();
  });

  it('builds the shortest unique path prefixes for duplicate basenames', () => {
    const controlplaneReference = parseMarkdownFileReference(
      '/Users/tangjianyin/Downloads/code/redeven/internal/envapp/ui_src/src/ui/services/controlplaneApi.ts#L278',
      'controlplaneApi.ts\nL278',
    );
    const anotherControlplaneReference = parseMarkdownFileReference(
      '/Users/tangjianyin/Downloads/code/redeven/internal/envapp/ui_src/src/ui/api/controlplaneApi.ts#L330',
      'controlplaneApi.ts\nL330',
    );

    const prefixMap = buildMarkdownFileReferencePrefixMap([
      controlplaneReference!,
      anotherControlplaneReference!,
    ]);

    expect(prefixMap.get('/Users/tangjianyin/Downloads/code/redeven/internal/envapp/ui_src/src/ui/services/controlplaneApi.ts')).toBe('…/services/');
    expect(prefixMap.get('/Users/tangjianyin/Downloads/code/redeven/internal/envapp/ui_src/src/ui/api/controlplaneApi.ts')).toBe('…/api/');
  });

  it('parses local file hrefs independently from the visible link label', () => {
    expect(parseMarkdownLocalFileHref('/Users/tangjianyin/.codex-cc/auth.json#L3')).toEqual({
      href: '/Users/tangjianyin/.codex-cc/auth.json#L3',
      path: '/Users/tangjianyin/.codex-cc/auth.json',
      fragment: 'L3',
    });
    expect(basenameFromMarkdownPath('/Users/tangjianyin/.codex-cc/auth.json')).toBe('auth.json');
  });
});
