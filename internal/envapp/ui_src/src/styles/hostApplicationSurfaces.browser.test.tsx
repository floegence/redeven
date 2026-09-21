import '../index.css';
import '../ui/pages/host-applications.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { HostApplicationSetupPanel } from '../ui/pages/HostApplicationSetupPanel';
import { Dialog } from '../ui/primitives/EnvAppModal';
import { enUS } from '../ui/i18n/locales/en-US';
import viewerHTML from '../../../../codeapp/appserver/host_application_viewer/viewer.html?raw';
import viewerCSS from '../../../../codeapp/appserver/host_application_viewer/viewer.css?raw';
import viewerJS from '../../../../codeapp/appserver/host_application_viewer/macos.js?raw';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });

it('keeps download choices and actions together on wide pages and inside compact dialogs', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'width:1100px;padding:24px;background:var(--background)';
  document.body.append(host);
  const [method, setMethod] = createSignal<'host' | 'desktop'>('host');
  const [dialog, setDialog] = createSignal(false);
  const panel = (inDialog = false) => <HostApplicationSetupPanel
    setup={{ state: 'available', received_bytes: 0, expected_bytes: 177000000, can_cancel: false, package: {id:'fixture',architecture:'arm64',size_bytes:177000000,installed_bytes:300000000} }}
    downloadMethod={method()} onDownloadMethodChange={setMethod} allowed canRelay submitting={false} disconnected={false}
    inDialog={inDialog} onStart={() => {}} onCancel={() => {}} onReconnect={() => {}} onUpload={() => {}}
  />;
  dispose = render(() => <>{panel()}<Dialog open={dialog()} onOpenChange={setDialog} title="Text Editor" class="host-apps-dialog" contentClass="host-apps-dialog-content">{panel(true)}</Dialog></>, host);
  const preparation = host.querySelector<HTMLElement>('.host-apps-preparation')!;
  expect(preparation.getBoundingClientRect().width).toBeLessThanOrEqual(560);
  const hostRadio = preparation.querySelector<HTMLInputElement>('input[value=host]')!;
  const desktopRadio = preparation.querySelector<HTMLInputElement>('input[value=desktop]')!;
  expect(hostRadio.checked).toBe(true);
  hostRadio.focus(); await userEvent.keyboard('{ArrowDown}');
  expect(desktopRadio.checked).toBe(true);
  expect(document.activeElement).toBe(desktopRadio);
  const actions = preparation.querySelector('.host-apps-preparation-actions')!.getBoundingClientRect();
  expect(actions.left - preparation.getBoundingClientRect().left).toBeLessThan(1);
  host.style.width = '320px';
  expect(preparation.scrollWidth).toBeLessThanOrEqual(preparation.clientWidth);
  setDialog(true);
  await expect.poll(() => document.querySelector('[role=dialog]')).toBeTruthy();
  const modal = document.querySelector<HTMLElement>('[role=dialog]')!;
  expect(modal.querySelector<HTMLInputElement>('input[value=desktop]')!.checked).toBe(true);
  expect(modal.querySelector('h2')?.textContent).not.toBe('Prepare host applications');
  expect(modal.scrollWidth).toBeLessThanOrEqual(modal.clientWidth);
});

it.each([390, 1000])('separates connection identity and keeps the left drawer within a %s px viewer', async width => {
  const frame = document.createElement('iframe');
  frame.style.cssText = `width:${width}px;height:660px;border:0`;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(enUS.hostApplications)) {
    const name = key.startsWith('mac') ? key[3].toLowerCase() + key.slice(4) : key;
    if (typeof value === 'string') copy[name] = value;
  }
  const config = {base:'/fixture', icon:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', copy};
  frame.srcdoc = viewerHTML.replaceAll('{{.Locale}}', 'en-US').replaceAll('{{.Name}}', 'Text Editor')
    .replaceAll('{{.Nonce}}', 'fixture').replace('{{.Style}}', viewerCSS).replace('{{.Config}}', JSON.stringify(config))
    .replace('{{.Script}}', `window.fetch = () => new Promise(() => {});\n${viewerJS}`);
  document.body.append(frame);
  await expect.poll(() => frame.contentDocument?.querySelector('.mac-app-controls-toggle')).toBeTruthy();
  const doc = frame.contentDocument!, view = frame.contentWindow!;
  expect(view.getComputedStyle(doc.querySelector('#fallback-icon')!).display).toBe('none');
  const identity = doc.querySelector('.app-identity')!.getBoundingClientRect();
  const title = doc.querySelector('h1')!.getBoundingClientRect();
  expect(title.top - identity.bottom).toBeGreaterThanOrEqual(20);
  doc.body.dataset.state = 'disconnected';
  expect(view.getComputedStyle(doc.querySelector('.progress')!).display).toBe('none');
  expect(doc.querySelector('h1')!.getBoundingClientRect().top - doc.querySelector('.app-identity')!.getBoundingClientRect().bottom).toBeGreaterThanOrEqual(20);
  doc.body.dataset.state = 'active';
  doc.querySelector<HTMLElement>('.mac-app-controls')!.hidden = false;
  const toggle = doc.querySelector<HTMLButtonElement>('.mac-app-controls-toggle')!;
  const drawer = doc.querySelector<HTMLElement>('.mac-app-drawer')!;
  expect(drawer.hidden).toBe(true);
  expect(toggle.getBoundingClientRect().left).toBeLessThan(16);
  toggle.click();
  await Promise.all(drawer.getAnimations().map(animation => animation.finished));
  const bounds = drawer.getBoundingClientRect();
  expect(bounds.left).toBeLessThan(60);
  expect(bounds.right).toBeLessThan(width);
  expect(bounds.top).toBeGreaterThanOrEqual(10);
  expect(bounds.bottom).toBeLessThanOrEqual(650);
  expect(drawer.scrollWidth).toBeLessThanOrEqual(drawer.clientWidth);
  expect(doc.querySelector('#application')!.getBoundingClientRect().width).toBe(width);
  toggle.click();
  expect(drawer.hidden).toBe(true);
});
