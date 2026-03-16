import { afterEach, describe, expect, it, vi } from 'vitest';

import { createClientId } from './clientId';

describe('createClientId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefers crypto.randomUUID when available', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => 'uuid-from-randomUUID',
    } as unknown as Crypto);

    expect(createClientId('message')).toBe('uuid-from-randomUUID');
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

    expect(createClientId('message')).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });

  it('falls back to a prefixed id when crypto is unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    vi.spyOn(Date, 'now').mockReturnValue(1_742_109_600_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);

    expect(createClientId('message')).toBe('message-m8bb2qdc-4fzzzxjylr');
  });
});
