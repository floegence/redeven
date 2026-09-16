// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createClientId } from './clientId';

describe('createClientId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to getRandomValues when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (buffer: Uint8Array) => {
        for (let index = 0; index < buffer.length; index += 1) {
          buffer[index] = index;
        }
        return buffer;
      },
    } as unknown as Crypto);

    expect(createClientId()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });

  it('fails explicitly when cryptographic randomness is unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    expect(() => createClientId()).toThrow();
  });
});
