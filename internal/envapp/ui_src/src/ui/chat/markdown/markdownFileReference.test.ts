import { describe, expect, it } from 'vitest';

import { buildMarkdownFileReferencePrefixMap, parseMarkdownFileReference } from './markdownFileReference';

describe('parseMarkdownFileReference', () => {
  it('parses multiline file reference labels from local file links', () => {
    const reference = parseMarkdownFileReference(
      '/Users/tangjianyin/Downloads/code/redeven-agent/internal/envapp/ui_src/src/ui/services/controlplaneApi.ts#L278',
      'controlplaneApi.ts\nL278',
    );

    expect(reference).toEqual({
      href: '/Users/tangjianyin/Downloads/code/redeven-agent/internal/envapp/ui_src/src/ui/services/controlplaneApi.ts#L278',
      path: '/Users/tangjianyin/Downloads/code/redeven-agent/internal/envapp/ui_src/src/ui/services/controlplaneApi.ts',
      displayName: 'controlplaneApi.ts',
      lineLabel: 'L278',
      title: '/Users/tangjianyin/Downloads/code/redeven-agent/internal/envapp/ui_src/src/ui/services/controlplaneApi.ts#L278',
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
      '/Users/tangjianyin/Downloads/code/redeven-agent/internal/envapp/ui_src/src/ui/services/controlplaneApi.ts#L278',
      'controlplaneApi.ts\nL278',
    );
    const anotherControlplaneReference = parseMarkdownFileReference(
      '/Users/tangjianyin/Downloads/code/redeven-agent/internal/envapp/ui_src/src/ui/api/controlplaneApi.ts#L330',
      'controlplaneApi.ts\nL330',
    );

    const prefixMap = buildMarkdownFileReferencePrefixMap([
      controlplaneReference!,
      anotherControlplaneReference!,
    ]);

    expect(prefixMap.get('/Users/tangjianyin/Downloads/code/redeven-agent/internal/envapp/ui_src/src/ui/services/controlplaneApi.ts')).toBe('…/services/');
    expect(prefixMap.get('/Users/tangjianyin/Downloads/code/redeven-agent/internal/envapp/ui_src/src/ui/api/controlplaneApi.ts')).toBe('…/api/');
  });
});
