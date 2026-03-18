import { describe, expect, it } from 'vitest';

import { isLoopbackOnlyBind, parseLocalUIBind } from './localUIBind';

describe('localUIBind', () => {
  it('accepts localhost with a fixed port', () => {
    const bind = parseLocalUIBind('localhost:23998');
    expect(bind).toMatchObject({
      host: 'localhost',
      port: 23998,
      localhost: true,
      loopback: true,
    });
    expect(isLoopbackOnlyBind(bind)).toBe(true);
  });

  it('accepts an explicit loopback dynamic port', () => {
    const bind = parseLocalUIBind('127.0.0.1:0');
    expect(bind.port).toBe(0);
    expect(isLoopbackOnlyBind(bind)).toBe(true);
  });

  it('accepts wildcard lan exposure', () => {
    const bind = parseLocalUIBind('0.0.0.0:24000');
    expect(bind.wildcard).toBe(true);
    expect(isLoopbackOnlyBind(bind)).toBe(false);
  });

  it('rejects localhost dynamic port', () => {
    expect(() => parseLocalUIBind('localhost:0')).toThrow('localhost:0 is not supported');
  });

  it('rejects hostnames', () => {
    expect(() => parseLocalUIBind('example.com:24000')).toThrow('host must be localhost or an IP literal');
  });
});
