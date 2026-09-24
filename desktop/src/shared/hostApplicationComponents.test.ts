import { describe, expect, it } from 'vitest';
import { parseHostApplicationComponentsProgress as parse } from './hostApplicationComponents';

describe('component cache progress', () => {
  it('keeps download totals unknown during cache inspection and waiting', () => {
    for (const phase of ['waiting', 'checking']) {
      expect(parse({ phase, component_bytes: 100, downloaded_bytes: 0 })).toEqual({ phase, component_bytes: 100, downloaded_bytes: 0 });
      expect(parse({ phase, component_bytes: 100, downloaded_bytes: 0, cached_bytes: 0, download_bytes: 100 })).toBeUndefined();
    }
  });
  it('accepts fully cached packaging and counts only missing downloads', () => {
    const cached = { phase: 'packing', component_bytes: 100, cached_bytes: 100, download_bytes: 0, downloaded_bytes: 0 };
    expect(parse(cached)).toEqual(cached);
    const partial = { phase: 'downloading', component_bytes: 100, cached_bytes: 60, download_bytes: 40, downloaded_bytes: 20 };
    expect(parse(partial)).toEqual(partial);
    for (const change of [{ downloaded_bytes: 41 }, { cached_bytes: 70 }, { download_bytes: -1 }, { phase: 'packing' }, { downloaded_bytes: NaN }]) expect(parse({ ...partial, ...change })).toBeUndefined();
  });
});
