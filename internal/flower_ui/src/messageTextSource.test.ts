import { describe, expect, it } from 'vitest';
import { createMessageTextSource } from './messageTextSource';

describe('bounded message append source', () => {
  it('retains absolute cursors while dropping redundant old chunks', () => {
    let revision = 0;
    const log = createMessageTextSource(() => revision, value => { revision = value; });
    for (let index = 0; index < 10000; index++) log.append(String(index));
    expect(log.source.length).toBe(10000);
    expect(log.source.revision).toBe(10000);
    expect(log.source.start).toBe(9744);
    expect(log.source.read(9998)).toEqual(['9998', '9999']);
    expect(log.source.read(0)).toHaveLength(256);
  });
  it('bounds retained bytes independently of chunk count', () => {
    const log = createMessageTextSource(() => 0, () => {});
    log.append('x'.repeat(200000));
    expect(log.source.start).toBe(1);
    expect(log.source.read(0)).toEqual([]);
    log.append('🌸');
    expect(log.source.read(1)).toEqual(['🌸']);
  });
});
