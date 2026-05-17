// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { normalizeWorkbenchTheme } from './workbenchTheme';

describe('workbenchTheme', () => {
  it('normalizes supported Workbench themes without legacy migration', () => {
    expect(normalizeWorkbenchTheme('mica')).toBe('mica');
    expect(normalizeWorkbenchTheme('unknown')).toBe('default');
    expect(normalizeWorkbenchTheme('unknown', 'midnight')).toBe('midnight');
  });
});
