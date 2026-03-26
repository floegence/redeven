import { describe, expect, it } from 'vitest';

import { parseMarkdownFileReference } from './markdownFileReference';

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
});
