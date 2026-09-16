import { describe, expect, it } from 'vitest';

import { parseLocalUIProtocol } from './settingsIPC';

describe('Local UI protocol defaults', () => {
  it('uses HTTP when the protocol was never configured', () => {
    expect(parseLocalUIProtocol(undefined)).toBe('http');
  });

  it.each(['http', 'https'] as const)('preserves the explicit %s protocol', (protocol) => {
    expect(parseLocalUIProtocol(protocol)).toBe(protocol);
  });

  it.each(['', 'ftp', 'HTTPS', null, false])('rejects the invalid explicit value %j', (protocol) => {
    expect(() => parseLocalUIProtocol(protocol)).toThrow('Choose HTTP or HTTPS');
  });
});
