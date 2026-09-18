import { afterEach, describe, expect, it, vi } from 'vitest';
import { batch, createSignal } from 'solid-js';
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
    endpoints={rows()} open={open()} onOpenChange={next => batch(() => {
      setOpen(next); if (!next) setSelected('');
    })} selectedEndpointID={selected()}
    selectEndpointForQRCode={setSelected} openInBrowser={browser} copyEnvironmentValue={copy} />, root));
  const trigger = root.querySelector('[aria-haspopup="dialog"]') as HTMLElement;
  trigger.click();
  await settle();
  return { setURLs, setSelected, setOpen, open, copy, browser, trigger };
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('Environment connection popover', () => {
  it('presents remote loopback as internal listener details and preserves the disclosure on refresh', async () => {
    const test = await mount();
    const details = document.querySelector<HTMLDetailsElement>('.redeven-endpoint-listener')!;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    expect(document.body.textContent).toContain('On this device, choose “Open Env App” in Desktop to connect.');
    expect(document.body.textContent).toContain('Desktop connects to this environment over SSH.');
    details.open = true;
    const summary = details.querySelector('summary')!;
    summary.focus();
    test.setURLs(['http://localhost:23998/']); await settle();
    expect(document.querySelector('.redeven-endpoint-listener')).toBe(details);
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(summary);
    expect(details.textContent).toContain('http://localhost:23998/');
    expect(details.textContent).toContain('gzcom');
    expect(details.querySelector('button')).toBeNull();
    test.setURLs(['https://192.0.2.20:23998/']); await settle();
    expect(document.querySelector('.redeven-endpoint-listener')).toBeNull();
    expect(document.body.textContent).toContain('Network access address');
    expect(document.querySelector('[aria-label="Open in browser"]')).not.toBeNull();
  });

  it('shows remote host context and permits only management copy for host-only addresses', async () => {
    const test = await mount();
    expect(document.body.textContent).toContain('gzcom:22');
    expect(document.body.textContent).toContain('Only inside gzcom');
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

  it('preserves row identity and copy feedback when equivalent addresses refresh or reorder', async () => {
    const test = await mount();
    const urls = ['https://192.0.2.20:23998/', 'http://localhost:23998/'];
    test.setURLs(urls); await settle();
    const copy = document.querySelector<HTMLButtonElement>('[aria-label="Copy Environment URL"]')!;
    const address = copy.closest('.redeven-card-endpoint-row')!;
    const text = address.querySelector('.redeven-card-endpoint-value')!;
    copy.click(); copy.focus(); await settle();
    const range = document.createRange(); range.selectNodeContents(text);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    for (const next of [[...urls], [...urls].reverse()]) {
      test.setURLs(next); await settle();
      expect(document.querySelector('[aria-label="Copy Environment URL"]')).toBe(copy);
      expect(copy.closest('.redeven-card-endpoint-row')).toBe(address);
      expect(document.activeElement).toBe(copy);
      expect(copy.dataset.copied).toBe('true');
      expect(window.getSelection()!.toString()).toBe(urls[0]);
    }
  });

  it('does not carry copied feedback to a different shared address', async () => {
    const test = await mount();
    const urls = ['https://192.0.2.20:23998/', 'https://192.0.2.21:23998/'];
    test.setURLs(urls); test.setSelected(`address:${urls[0]}`); await settle();
    (document.querySelector('.redeven-endpoint-qr-copy-button') as HTMLButtonElement).click(); await settle();
    expect(document.querySelector('.redeven-endpoint-qr-copy-label')?.textContent).toBe('Copied');
    test.setSelected(`address:${urls[1]}`); await settle();
    expect(document.querySelector('.redeven-endpoint-qr-value')?.textContent).toBe(urls[1]);
    expect(document.querySelector('.redeven-endpoint-qr-copy-label')?.textContent).toBe('Copy');
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

  it('retains a non-interactive closing panel and cancels dismissal on a rapid reopen', async () => {
    const test = await mount();
    const panel = document.querySelector('.redeven-endpoints-popover');
    test.setOpen(false);
    await settle();
    expect(document.querySelector('.redeven-endpoints-popover')).toBe(panel);
    expect((panel as HTMLElement).inert).toBe(true);
    test.setOpen(true);
    await settle();
    expect(document.querySelector('.redeven-endpoints-popover')).toBe(panel);
    expect((panel as HTMLElement).inert).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 220));
    expect(test.open()).toBe(true);
    expect(document.querySelectorAll('.redeven-endpoints-popover')).toHaveLength(1);
    test.setOpen(false);
    await new Promise(resolve => setTimeout(resolve, 240));
    expect(document.querySelector('.redeven-endpoints-popover')).toBeNull();
  });

  it('moves focus into the panel and restores it when its close control is used', async () => {
    const test = await mount();
    const close = document.querySelector('[aria-label="Close connection details"]') as HTMLButtonElement;
    expect(document.activeElement).toBe(close);
    close.click();
    expect(test.open()).toBe(false);
    expect(document.activeElement).toBe(test.trigger);
  });


  it('retains sharing during dismissal without retaining an invalidated address', async () => {
    const test = await mount();
    test.setURLs(['https://192.0.2.20:23998/']);
    test.setSelected('address:https://192.0.2.20:23998/');
    await settle();
    (document.querySelector('[aria-label="Close connection details"]') as HTMLButtonElement).click();
    await settle();
    expect(document.querySelector('.redeven-endpoints-share')?.getAttribute('data-expanded')).toBe('true');
    expect(document.querySelector('.redeven-endpoint-qr-image')).not.toBeNull();
    test.setURLs(['http://localhost:23998/']);
    await settle();
    expect(document.querySelector('.redeven-endpoint-qr-image')).toBeNull();
  });

});
