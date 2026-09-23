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
  disposers.push(render(() => <EndpointsPopover environmentID={host} i18n={createDesktopI18n('en-US')} environmentLabel={host}
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
  it('keeps network guidance in accessible help without a visible description row', async () => {
    const test = await mount();
    test.setURLs(['https://192.0.2.20:23998/']); await settle();
    const group = document.querySelector('[data-address-scope="network"]')!;
    const help = group.querySelector<HTMLButtonElement>('.redeven-address-help')!;
    expect(help).not.toBeNull();
    expect(group.querySelector('.redeven-card-endpoint-detail')).toBeNull();
    const description = document.getElementById(help.getAttribute('aria-describedby')!)!;
    expect(description.textContent).toBe('Network address. Availability depends on your network connection.');
    expect(description.classList.contains('sr-only')).toBe(true);
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    help.focus();
    await new Promise(resolve => setTimeout(resolve, 350));
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(description.textContent);
    expect(test.open()).toBe(true);
    group.querySelector<HTMLButtonElement>('[aria-label="Copy Environment URL"]')!.focus();
    await settle();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('keeps multiple internal listeners in one disclosure without address actions', async () => {
    const test = await mount();
    test.setURLs(['http://localhost:23998/', 'http://[::1]:23998/']); await settle();
    const group = document.querySelector('[data-address-scope="environment_only"]')!;
    expect(group.querySelectorAll('details')).toHaveLength(1);
    expect(group.querySelectorAll('[data-endpoint-kind="address"]')).toHaveLength(2);
    expect(group.querySelectorAll('button')).toHaveLength(0);
    expect(group.textContent?.match(/Choose “Open Env App”/g)).toHaveLength(1);
  });

  it('groups and filters many addresses while preserving sharing and input state across refresh', async () => {
    const test = await mount();
    const ipv6 = 'https://[2001:db8::42]:23998/';
    const urls = [...Array.from({ length: 200 }, (_, n) => `https://192.0.2.${n + 1}:23998/`), ipv6];
    test.setURLs(urls); await settle();
    const group = document.querySelector('[data-address-scope="network"]')!;
    expect(group).not.toBeNull();
    expect(group.textContent?.match(/Availability depends on your network connection/g)).toHaveLength(1);
    const filter = group.querySelector<HTMLInputElement>('[aria-label="Filter addresses"]')!;
    filter.value = '2001:db8'; filter.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    const viewport = group.querySelector('.redeven-address-viewport')!;
    expect(viewport.querySelectorAll('[data-endpoint-id]')).toHaveLength(1);
    const share = viewport.querySelector<HTMLButtonElement>('[aria-label="Share connection"]')!;
    share.click(); await settle();
    expect(document.querySelector('.redeven-endpoint-qr-value')?.textContent).toBe(ipv6);
    filter.focus(); filter.setSelectionRange(0, 4);
    test.setURLs([...urls].reverse()); await settle();
    expect(document.querySelector('[aria-label="Filter addresses"]')).toBe(filter);
    expect(document.activeElement).toBe(filter);
    expect(filter.value).toBe('2001:db8');
    expect(filter.selectionEnd).toBe(4);
    expect(group.querySelector('.redeven-address-viewport')).toBe(viewport);
    expect(viewport.querySelector('[aria-label="Share connection"]')).toBe(share);
    filter.value = 'missing'; filter.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    expect(group.textContent).toContain('No matching addresses');
    expect(document.querySelector('.redeven-endpoint-qr-value')?.textContent).toBe(ipv6);
    test.setURLs(urls.filter(url => url !== ipv6)); await settle();
    expect(document.querySelector('.redeven-endpoint-qr-image')).toBeNull();
    group.querySelector<HTMLButtonElement>('[aria-label="Clear address filter"]')!.click(); await settle();
    expect(filter.value).toBe('');
    expect(viewport.querySelectorAll('[data-endpoint-id]')).toHaveLength(200);
    filter.focus(); test.setURLs([urls[0]!]); await settle();
    expect(document.querySelector('[aria-label="Filter addresses"]')).toBe(filter);
    expect(document.activeElement).toBe(filter);
  });

  it('presents remote loopback as internal listener details and preserves the disclosure on refresh', async () => {
    const test = await mount();
    const details = document.querySelector<HTMLDetailsElement>('.redeven-endpoint-listener')!;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    expect(document.body.textContent).toContain('Choose “Open Env App” in Desktop to enter this environment.');
    expect(document.querySelector('[data-endpoint-id="host"]')?.textContent).toContain('gzcom:22');
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
