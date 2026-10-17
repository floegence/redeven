import { describe, expect, it } from 'vitest';
import { toolImagePath } from './toolImagePath';

describe('tool image routes', () => {
  it('accepts only canonical bounded image references and exact thread identities', () => {
    const hash = 'a'.repeat(64);
    expect(toolImagePath({ thread_id: 'thread_1', resource_ref: `image://${hash}/jpeg` }))
      .toBe(`/_redeven_proxy/api/ai/threads/thread_1/tool-media/${hash}/jpeg`);
    expect(toolImagePath({ thread_id: 'thread_1', resource_ref: 'media:v1:' + hash }))
      .toBe('/_redeven_proxy/api/ai/threads/thread_1/tool-media/locator/' + hash);
    for (const resource_ref of ['media:v1:' + hash + '/png', 'media:v2:' + hash, 'media:v1:' + hash.toUpperCase(), `file:///tmp/a.png`, `image://${hash}/svg`, `image://${hash}/png?thread_id=other`]) {
      expect(() => toolImagePath({ thread_id: 'thread_1', resource_ref })).toThrow();
    }
    expect(() => toolImagePath({ thread_id: '../other', resource_ref: `image://${hash}/png` })).toThrow();
  });
});
