import { describe, expect, it } from 'vitest';

import { isLoopbackOnlyBind, localUIBindsConflict, parseLocalUIBind } from './localUIBind';

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
    const bind = parseLocalUIBind('0.0.0.0:23998');
    expect(bind.wildcard).toBe(true);
    expect(isLoopbackOnlyBind(bind)).toBe(false);
  });

  it('rejects localhost dynamic port', () => {
    expect(() => parseLocalUIBind('localhost:0')).toThrow('localhost:0 is not supported');
  });

  it('rejects hostnames', () => {
    expect(() => parseLocalUIBind('example.com:24000')).toThrow('host must be localhost or an IP literal');
  });

  it('treats localhost as conflicting with explicit loopback binds on the same port', () => {
    expect(localUIBindsConflict('localhost:23998', '127.0.0.1:23998')).toBe(true);
    expect(localUIBindsConflict('localhost:23998', '[::1]:23998')).toBe(true);
  });

  it('treats wildcard binds as conflicting with loopback binds on the same port', () => {
    expect(localUIBindsConflict('0.0.0.0:23998', 'localhost:23998')).toBe(true);
    expect(localUIBindsConflict('[::]:23998', '[::1]:23998')).toBe(true);
  });

  it('does not treat dynamic binds or different ports as conflicts', () => {
    expect(localUIBindsConflict('127.0.0.1:0', 'localhost:23998')).toBe(false);
    expect(localUIBindsConflict('0.0.0.0:24000', 'localhost:23998')).toBe(false);
  });
});
