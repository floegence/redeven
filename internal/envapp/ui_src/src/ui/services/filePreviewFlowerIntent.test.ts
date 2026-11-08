// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { consumeFilePreviewFlowerIntent, filePreviewFlowerIntent } from './filePreviewFlowerIntent';
describe('received preview Flower identity', () => {
  it('consumes a browser handoff once and rejects duplicate paths', () => {
    window.history.replaceState({}, '', '/?ask_file=%2Fdocs%2Freport.md');
    expect(consumeFilePreviewFlowerIntent()?.source_surface).toBe('file_preview'); expect(window.location.search).toBe('');
    expect(consumeFilePreviewFlowerIntent()).toBeNull();
    window.history.replaceState({}, '', '/?ask_file=/a&ask_file=/b');
    expect(consumeFilePreviewFlowerIntent()).toBeNull(); expect(window.location.search).toBe('');
  });

  it('produces the canonical file context and working directory', () => {
    expect(filePreviewFlowerIntent('/docs/文 #%.md')).toMatchObject({ source_surface: 'file_preview', suggested_working_dir: '/docs',
      context_items: [{ kind: 'file_path', path: '/docs/文 #%.md', is_directory: false }],
      context_action: { source: { surface: 'file_preview' }, context: [{ kind: 'file_path', path: '/docs/文 #%.md', is_directory: false }] } });
  });
  it.each(['', '/', '/a/../b', '/a\\b', 'relative', '/' + 'a'.repeat(4096)])('rejects invalid file handoffs %s', path => {
    expect(filePreviewFlowerIntent(path)).toBeNull();
  });
});
