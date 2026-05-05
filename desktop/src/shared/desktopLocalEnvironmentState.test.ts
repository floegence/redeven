import { describe, expect, it } from 'vitest';

import {
  createDesktopLocalEnvironmentState,
  isDefaultDesktopLocalEnvironmentState,
} from './desktopLocalEnvironmentState';

describe('desktopLocalEnvironmentState', () => {
  it('treats any requested id as the protected default local environment', () => {
    expect(isDefaultDesktopLocalEnvironmentState(createDesktopLocalEnvironmentState('default'))).toBe(true);
    expect(isDefaultDesktopLocalEnvironmentState(createDesktopLocalEnvironmentState('lab'))).toBe(true);
  });
});
