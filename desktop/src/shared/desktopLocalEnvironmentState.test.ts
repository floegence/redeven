import { describe, expect, it } from 'vitest';

import {
  createDesktopLocalEnvironmentState,
  isDefaultDesktopLocalEnvironmentState,
} from './desktopLocalEnvironmentState';

describe('desktopLocalEnvironmentState', () => {
  it('creates the protected Local Environment identity', () => {
    expect(isDefaultDesktopLocalEnvironmentState(createDesktopLocalEnvironmentState())).toBe(true);
  });
});
