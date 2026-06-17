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
      lineNumber: 278,
      columnNumber: null,
      title: '/Users/tangjianyin/Downloads/code/redeven/internal/envapp/ui_src/src/ui/services/controlplaneApi.ts#L278',
    });
  });

  it('parses hash-style line labels from local file links', () => {
    const reference = parseMarkdownFileReference(
      '/Users/tangjianyin/Downloads/code/redeven/CODEX_UI.md#L121',
      'CODEX_UI.md#L121',
    );

    expect(reference).toEqual({
      href: '/Users/tangjianyin/Downloads/code/redeven/CODEX_UI.md#L121',
      path: '/Users/tangjianyin/Downloads/code/redeven/CODEX_UI.md',
      displayName: 'CODEX_UI.md',
      lineLabel: 'L121',
      lineNumber: 121,
      columnNumber: null,
      title: '/Users/tangjianyin/Downloads/code/redeven/CODEX_UI.md#L121',
    });
  });

  it('parses colon-style line labels from local file hrefs without treating them as filename text', () => {
    const reference = parseMarkdownFileReference(
      '/Users/tangjianyin/Downloads/code/codex/codex-rs/core/src/exec.rs:1306',
      'exec.rs',
    );

    expect(reference).toEqual({
      href: '/Users/tangjianyin/Downloads/code/codex/codex-rs/core/src/exec.rs:1306',
      path: '/Users/tangjianyin/Downloads/code/codex/codex-rs/core/src/exec.rs',
      displayName: 'exec.rs',
      lineLabel: 'L1306',
      lineNumber: 1306,
      columnNumber: null,
      title: '/Users/tangjianyin/Downloads/code/codex/codex-rs/core/src/exec.rs:1306',
    });
  });

  it('parses colon-style line and column labels from local file hrefs', () => {
    const reference = parseMarkdownFileReference(
      './src/main.ts:42:7',
      'main.ts',
    );

    expect(reference).toEqual({
      href: './src/main.ts:42:7',
      path: './src/main.ts',
      displayName: 'main.ts',
      lineLabel: 'L42C7',
      lineNumber: 42,
      columnNumber: 7,
      title: './src/main.ts:42:7',
    });
  });

  it('keeps Windows drive letters while stripping trailing colon line labels', () => {
    expect(parseMarkdownLocalFileHref('C:\\Users\\me\\repo\\src\\main.rs:12')).toEqual({
      href: 'C:\\Users\\me\\repo\\src\\main.rs:12',
      path: 'C:\\Users\\me\\repo\\src\\main.rs',
      fragment: '',
      lineLabel: 'L12',
      lineNumber: 12,
      columnNumber: null,
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
      lineLabel: 'L3',
      lineNumber: 3,
      columnNumber: null,
    });
    expect(basenameFromMarkdownPath('/Users/tangjianyin/.codex-cc/auth.json')).toBe('auth.json');
  });
});
