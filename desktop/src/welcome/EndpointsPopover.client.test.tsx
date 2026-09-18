import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { EndpointsPopover } from './App';
import { buildRuntimeConnectionRows } from '../shared/desktopEnvironmentConnection';
import { createDesktopI18n } from '../shared/i18n';

const disposers: Array<() => void> = [];
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

async function mount(host = 'gzcom') {
  const root = document.createElement('div');
  document.body.append(root);
  const [urls, setURLs] = createSignal<readonly string[]>(['http://localhost:23998/']);
  const [open, setOpen] = createSignal(false);
  const [selected, setSelected] = createSignal('');
  const browser = vi.fn(async () => {});
  const copy = vi.fn(async () => {});
  const rows = () => buildRuntimeConnectionRows({
    context: {
      host_access: { kind: 'ssh_host', ssh: { ssh_destination: host, ssh_port: 22, auth_mode: 'key_agent', connect_timeout_seconds: 10 } },
      placement: { kind: 'host_process', runtime_root: '~/.redeven' },
    },
    urls: urls(),
    health: { status: 'online', freshness: 'fresh', source: 'ssh_runtime_probe', checked_at_unix_ms: 1 },
  });
  disposers.push(render(() => <EndpointsPopover i18n={createDesktopI18n('en-US')} environmentLabel={host}
    endpoints={rows()} open={open()} onOpenChange={setOpen} selectedEndpointID={selected()}
    selectEndpointForQRCode={setSelected} openInBrowser={browser} copyEnvironmentValue={copy} />, root));
  const trigger = root.querySelector('[aria-haspopup="dialog"]') as HTMLElement;
  trigger.click();
  await settle();
  return { setURLs, setSelected, open, copy, browser, trigger };
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('Environment connection popover', () => {
  it('shows remote host context and permits only management copy for host-only addresses', async () => {
    const test = await mount();
    expect(document.body.textContent).toContain('gzcom:22');
    expect(document.body.textContent).toContain('Only available on gzcom:22.');
    expect(document.querySelector('[aria-label="Share connection"]')).toBeNull();
    expect(document.querySelector('[aria-label="Copy Environment URL"]')).toBeNull();
    expect(document.querySelector('[aria-label="Open in browser"]')).toBeNull();
    (document.querySelector('[aria-label="Copy SSH host"]') as HTMLButtonElement).click();
    expect(test.copy).toHaveBeenCalledWith('gzcom:22', 'SSH host');
    expect(document.querySelector('img')).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(test.open()).toBe(false);
    expect(document.activeElement).toBe(test.trigger);
  });

  it('shares only real network URLs and removes stale QR content after an address change', async () => {
    const test = await mount();
    test.setURLs(['https://192.0.2.20:23998/']);
    await settle();
    (document.querySelector('[aria-label="Share connection"]') as HTMLButtonElement).click();
    await settle();
    expect(document.querySelector('.redeven-endpoint-qr-value')?.textContent).toBe('https://192.0.2.20:23998/');
    expect(document.querySelector('.redeven-endpoint-qr-image')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    (document.querySelector('[aria-label="Copy Environment URL"]') as HTMLButtonElement).click();
    expect(test.copy).toHaveBeenCalledWith('https://192.0.2.20:23998/', 'Environment URL');
    (document.querySelector('[aria-label="Open in browser"]') as HTMLButtonElement).click();
    expect(test.browser).toHaveBeenCalledWith('https://192.0.2.20:23998/');
    test.setURLs(['http://localhost:23998/']);
    await settle();
    expect(document.querySelector('img')).toBeNull();
    expect(document.body.textContent).not.toContain('192.0.2.20');
    expect(test.open()).toBe(true);
  });

  it('never renders a QR code for a selected connection or host-only address', async () => {
    const test = await mount('gzlight');
    for (const id of ['host', 'address:http://localhost:23998/']) {
      test.setSelected(id);
      await settle();
      expect(document.querySelector('img')).toBeNull();
    }
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(test.open()).toBe(false);
  });
});
