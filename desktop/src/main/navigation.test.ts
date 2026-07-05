import { describe, expect, it } from 'vitest';

import { isAllowedAppNavigation, isAllowedCodespaceWindowNavigation, isCodespaceURLForCodeSpace } from './navigation';
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

  it('rejects unsupported sandbox navigation outside the remote session family', () => {
    expect(isAllowedAppNavigation(
      'https://files-workbench.us.redeven-sandbox.test/',
      'https://env-0123456789abcdef0123456789abcdef.us.redeven-sandbox.test/',
    )).toBe(false);
    expect(isAllowedAppNavigation(
      'https://cs-workbench.us.redeven-sandbox.test/',
      'https://env-0123456789abcdef0123456789abcdef.us.redeven-sandbox.test/',
    )).toBe(true);
  });

  it('keeps production remote session navigation inside one region family', () => {
    expect(isAllowedAppNavigation(
      'https://cs-workbench.sg.redeven.online/',
      'https://env-0123456789abcdef0123456789abcdef.sg.redeven.online/',
    )).toBe(true);
    expect(isAllowedAppNavigation(
      'https://cs-workbench.usw.redeven.online/',
      'https://env-0123456789abcdef0123456789abcdef.sg.redeven.online/',
    )).toBe(false);
    expect(isAllowedAppNavigation(
      'https://env-0123456789abcdef0123456789abcdef.sg.redeven.online/',
      'https://rt-123.sg.redeven.online/',
    )).toBe(true);
  });

  it('recognizes codespace URLs by local route or remote sandbox host', () => {
    expect(isCodespaceURLForCodeSpace('http://127.0.0.1:43123/cs/demo/', 'demo')).toBe(true);
    expect(isCodespaceURLForCodeSpace('http://127.0.0.1:43123/cs/demo-other/', 'demo')).toBe(false);
    expect(isCodespaceURLForCodeSpace('https://cs-demo.sg.redeven.online/_redeven_boot/', 'demo')).toBe(true);
    expect(isCodespaceURLForCodeSpace('https://env-demo.sg.redeven.online/', 'demo')).toBe(false);
  });

  it('allows codespace window navigation only inside the session and matching codespace', () => {
    expect(isAllowedCodespaceWindowNavigation(
      'http://localhost:43123/cs/demo/',
      'http://127.0.0.1:43123/',
      'demo',
    )).toBe(true);
    expect(isAllowedCodespaceWindowNavigation(
      'http://localhost:43123/_redeven_proxy/env/',
      'http://127.0.0.1:43123/',
      'demo',
    )).toBe(false);
    expect(isAllowedCodespaceWindowNavigation(
      'https://cs-demo.sg.redeven.online/',
      'https://env-0123456789abcdef0123456789abcdef.sg.redeven.online/',
      'demo',
    )).toBe(true);
    expect(isAllowedCodespaceWindowNavigation(
      'https://cs-other.sg.redeven.online/',
      'https://env-0123456789abcdef0123456789abcdef.sg.redeven.online/',
      'demo',
    )).toBe(false);
    expect(isAllowedCodespaceWindowNavigation(
      'https://cs-demo.usw.redeven.online/',
      'https://env-0123456789abcdef0123456789abcdef.sg.redeven.online/',
      'demo',
    )).toBe(false);
  });
});
