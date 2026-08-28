import { describe, expect, it } from 'vitest';

import {
  isAllowedAppNavigation,
  isAllowedCodespaceWindowNavigation,
  isAllowedWebServiceWindowNavigation,
  isCodespaceURLForCodeSpace,
  isPortForwardURLForForward,
  resolveWebServiceBrowserAddress,
  routeWebServiceTargetRequest,
  webServiceBrowserExternalURL,
  webServiceBrowserDisplayURL,
} from './navigation';
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

  it('binds Web Service windows to the exact forward route', () => {
    expect(isPortForwardURLForForward('http://127.0.0.1:43123/pf/demo/docs', 'demo')).toBe(true);
    expect(isPortForwardURLForForward('https://pf-demo.sg.redeven.online/_redeven_boot/', 'demo')).toBe(true);
    expect(isPortForwardURLForForward('http://127.0.0.1:43123/pf/other/', 'demo')).toBe(false);
    expect(isAllowedWebServiceWindowNavigation(
      'https://pf-demo.sg.redeven.online/app',
      'https://env-session.sg.redeven.online/',
      'demo',
    )).toBe(true);
    expect(isAllowedWebServiceWindowNavigation(
      'https://pf-other.sg.redeven.online/app',
      'https://env-session.sg.redeven.online/',
      'demo',
    )).toBe(false);
  });

  it('maps the exact loopback service scope into its isolated Desktop origin', () => {
    const route = 'http://pf-demo.localhost:43123/';
    expect(routeWebServiceTargetRequest(
      'http://127.0.0.1:3000/assets/app.js?rev=1',
      route,
      'http://localhost:3000/',
      'demo',
    )).toBe('http://pf-demo.localhost:43123/assets/app.js?rev=1');
    expect(routeWebServiceTargetRequest(
      'ws://127.42.0.9:3000/plugins/live',
      route,
      'http://localhost:3000/',
      'demo',
    )).toBe('ws://pf-demo.localhost:43123/plugins/live');
    expect(routeWebServiceTargetRequest(
      'http://localhost:3000/pf/demo',
      route,
      'http://127.0.0.1:3000/',
      'demo',
    )).toBe('http://pf-demo.localhost:43123/pf/demo');
  });

  it('does not map remote, cross-port, cross-protocol, or external requests', () => {
    expect(routeWebServiceTargetRequest(
      'http://localhost:3001/assets/app.js',
      'http://pf-demo.localhost:43123/',
      'http://localhost:3000/',
      'demo',
    )).toBeNull();
    expect(routeWebServiceTargetRequest(
      'https://localhost:3000/assets/app.js',
      'http://pf-demo.localhost:43123/',
      'http://localhost:3000/',
      'demo',
    )).toBeNull();
    expect(routeWebServiceTargetRequest(
      'https://pf-demo.sg.redeven.online/assets/app.js',
      'https://pf-demo.sg.redeven.online/',
      'http://localhost:3000/',
      'demo',
    )).toBeNull();
    expect(routeWebServiceTargetRequest(
      'https://cdn.example.com/app.js',
      'http://pf-demo.localhost:43123/',
      'http://localhost:3000/',
      'demo',
    )).toBeNull();
    expect(routeWebServiceTargetRequest(
      'file:///tmp/app.js',
      'http://pf-demo.localhost:43123/',
      'http://localhost:3000/',
      'demo',
    )).toBeNull();
  });

  it('resolves browser address input inside the exact Web Service route', () => {
    expect(resolveWebServiceBrowserAddress(
      '/docs?q=1#api',
      'http://127.0.0.1:43123/pf/demo/',
      'http://localhost:3000/',
      'http://127.0.0.1:43123/',
      'demo',
    )).toBe('http://127.0.0.1:43123/pf/demo/docs?q=1#api');
    expect(resolveWebServiceBrowserAddress(
      'settings',
      'https://pf-demo.sg.redeven.online/app/',
      'http://localhost:3000/',
      'https://env-session.sg.redeven.online/',
      'demo',
    )).toBe('https://pf-demo.sg.redeven.online/settings');
    expect(resolveWebServiceBrowserAddress(
      '?tab=logs',
      'https://pf-demo.sg.redeven.online/app',
      'http://localhost:3000/',
      'https://env-session.sg.redeven.online/',
      'demo',
    )).toBe('https://pf-demo.sg.redeven.online/app?tab=logs');
    expect(resolveWebServiceBrowserAddress(
      'localhost:3000/docs',
      'http://127.0.0.1:43123/pf/demo/',
      'http://localhost:3000/',
      'http://127.0.0.1:43123/',
      'demo',
    )).toBe('http://127.0.0.1:43123/pf/demo/docs');
    expect(resolveWebServiceBrowserAddress(
      '3000',
      'http://127.0.0.1:43123/pf/demo/docs',
      'http://localhost:3000/',
      'http://127.0.0.1:43123/',
      'demo',
    )).toBe('http://127.0.0.1:43123/pf/demo/');
    expect(resolveWebServiceBrowserAddress(
      '3000/api?tab=routes#public',
      'http://127.0.0.1:43123/pf/demo/',
      'http://localhost:3000/',
      'http://127.0.0.1:43123/',
      'demo',
    )).toBe('http://127.0.0.1:43123/pf/demo/api?tab=routes#public');
    expect(resolveWebServiceBrowserAddress(
      ':3000',
      'http://127.0.0.1:43123/pf/demo/docs',
      'http://localhost:3000/',
      'http://127.0.0.1:43123/',
      'demo',
    )).toBe('http://127.0.0.1:43123/pf/demo/');
  });

  it('projects protected Web Service routes as the user-facing target address', () => {
    expect(webServiceBrowserDisplayURL(
      'http://127.0.0.1:43123/pf/demo/docs?q=1#api',
      'http://localhost:3000/',
      'demo',
    )).toBe('http://localhost:3000/docs?q=1#api');
    expect(webServiceBrowserDisplayURL(
      'https://pf-demo.sg.redeven.online/app/settings?tab=logs',
      'http://127.0.0.1:8080/',
      'demo',
    )).toBe('http://127.0.0.1:8080/app/settings?tab=logs');
    expect(webServiceBrowserDisplayURL(
      'https://pf-demo.sg.redeven.online/_redeven_boot/?env=env_demo#redeven=secret',
      'http://localhost:3000/',
      'demo',
    )).toBe('http://localhost:3000/');
  });

  it('opens the public pf route only when leaving the isolated Desktop window', () => {
    expect(webServiceBrowserExternalURL(
      'http://pf-demo.localhost:43123/docs?q=1#api',
      'http://127.0.0.1:23998/',
      'demo',
    )).toBe('http://127.0.0.1:23998/pf/demo/docs?q=1#api');
    expect(webServiceBrowserExternalURL(
      'https://pf-demo.sg.redeven.online/docs',
      'https://env-demo.sg.redeven.online/',
      'demo',
    )).toBe('https://pf-demo.sg.redeven.online/docs');
  });

  it('rejects browser address input outside the current forward', () => {
    expect(resolveWebServiceBrowserAddress(
      'https://pf-other.sg.redeven.online/',
      'https://pf-demo.sg.redeven.online/',
      'http://localhost:3000/',
      'https://env-session.sg.redeven.online/',
      'demo',
    )).toBeNull();
    expect(resolveWebServiceBrowserAddress(
      'file:///tmp/demo',
      'http://127.0.0.1:43123/pf/demo/',
      'http://localhost:3000/',
      'http://127.0.0.1:43123/',
      'demo',
    )).toBeNull();
    expect(resolveWebServiceBrowserAddress(
      'http://localhost:4000/',
      'http://127.0.0.1:43123/pf/demo/',
      'http://localhost:3000/',
      'http://127.0.0.1:43123/',
      'demo',
    )).toBeNull();
    expect(resolveWebServiceBrowserAddress(
      'baidu.com',
      'http://127.0.0.1:43123/pf/demo/',
      'http://localhost:3000/',
      'http://127.0.0.1:43123/',
      'demo',
    )).toBeNull();
    expect(resolveWebServiceBrowserAddress(
      '4000',
      'http://127.0.0.1:43123/pf/demo/',
      'http://localhost:3000/',
      'http://127.0.0.1:43123/',
      'demo',
    )).toBeNull();
    expect(resolveWebServiceBrowserAddress(
      '65536',
      'http://127.0.0.1:43123/pf/demo/',
      'http://localhost:3000/',
      'http://127.0.0.1:43123/',
      'demo',
    )).toBeNull();
  });
});
