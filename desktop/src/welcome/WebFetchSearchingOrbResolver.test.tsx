import { describe, expect, it } from 'vitest';

import { WebFetchSearchingOrb } from '../../../internal/flower_ui/src/WebFetchSearchingOrb';

describe('Desktop Web Fetch Searching orb resolution', () => {
  it('loads the shared Flower component through the Desktop dependency graph', () => {
    expect(typeof WebFetchSearchingOrb).toBe('function');
  });
});
