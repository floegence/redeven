import { describe, expect, it } from 'vitest';

import { isAllowedAppNavigation } from './navigation';
import { isLoopbackHost } from './localUIURL';

describe('navigation', () => {
  it('recognizes supported loopback hosts', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('192.168.1.11')).toBe(false);
  });

  it('allows loopback urls on the Local UI port', () => {
    expect(isAllowedAppNavigation('http://127.0.0.1:43123/_redeven_proxy/env/', 'http://127.0.0.1:43123/')).toBe(true);
    expect(isAllowedAppNavigation('http://localhost:43123/cs/demo/', 'http://127.0.0.1:43123/')).toBe(true);
  });

  it('allows explicit local interface navigation only for the reported host', () => {
    expect(isAllowedAppNavigation('http://192.168.1.11:43123/_redeven_proxy/env/', 'http://192.168.1.11:43123/')).toBe(true);
    expect(isAllowedAppNavigation('http://192.168.1.12:43123/_redeven_proxy/env/', 'http://192.168.1.11:43123/')).toBe(false);
  });

  it('rejects non-loopback or mismatched-port navigation', () => {
    expect(isAllowedAppNavigation('https://example.com', 'http://127.0.0.1:43123/')).toBe(false);
    expect(isAllowedAppNavigation('http://127.0.0.1:43124/', 'http://127.0.0.1:43123/')).toBe(false);
  });
});
