import { describe, expect, it } from 'vitest';

import { safeLogText } from './logSafety';

describe('safeLogText', () => {
  it('normalizes control characters and bounds dynamic log values', () => {
    expect(safeLogText('  first\r\n\tsecond\u0000  ', 12)).toBe('first   seco...');
  });

  it('uses the default bound for invalid limits', () => {
    expect(safeLogText('value', 0)).toBe('value');
  });
});
