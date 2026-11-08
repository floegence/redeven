import { describe, expect, it } from 'vitest';
import { filePreviewFlowerIntent } from './filePreviewFlowerIntent';
describe('received preview Flower identity', () => {
  it('produces the canonical file context and working directory', () => {
    expect(filePreviewFlowerIntent('/docs/文 #%.md')).toMatchObject({ source_surface: 'file_preview', suggested_working_dir: '/docs',
      context_items: [{ kind: 'file_path', path: '/docs/文 #%.md', is_directory: false }],
      context_action: { source: { surface: 'file_preview' }, context: [{ kind: 'file_path', path: '/docs/文 #%.md', is_directory: false }] } });
  });
  it.each(['', '/', '/a/../b', '/a\\b', 'relative', '/' + 'a'.repeat(4096)])('rejects invalid file handoffs %s', path => {
    expect(filePreviewFlowerIntent(path)).toBeNull();
  });
});
