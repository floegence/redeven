import { describe, expect, it } from 'vitest';

import {
  createManagedLocalEnvironment,
  isDefaultLocalManagedEnvironment,
} from './desktopManagedEnvironment';

describe('desktopManagedEnvironment', () => {
  it('treats local:default as the protected default local environment', () => {
    expect(isDefaultLocalManagedEnvironment(createManagedLocalEnvironment('default'))).toBe(true);
    expect(isDefaultLocalManagedEnvironment(createManagedLocalEnvironment('lab'))).toBe(false);
  });
});
