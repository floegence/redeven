import { describe, expect, it } from 'vitest';
import { parseManualScreenshotRequest } from './manualScreenshotIPC';
describe('manual screenshot bridge request', () => {
  it('accepts only a bounded finite integral region', () => {
    const request = { url: 'https://example.test/env', region: { x: 0, y: 1, width: 320, height: 240 } };
    expect(parseManualScreenshotRequest(request)).toEqual(request);
    for (const width of [0, -1, NaN, Infinity, 1.5, 20000]) expect(() => parseManualScreenshotRequest({ ...request, region: { ...request.region, width } })).toThrow();
    expect(() => parseManualScreenshotRequest({ ...request, region: { ...request.region, target: 'other-window' } })).toThrow();
  });
});
