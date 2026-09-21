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
import connectionJS from '../../../../codeapp/appserver/host_application_viewer/connection.js?raw';
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
    .replace('{{.Script}}', `window.fetch = () => new Promise(() => {});\n${connectionJS}\n${viewerJS}`);
  document.body.append(frame);
  await expect.poll(() => frame.contentDocument?.querySelector('.mac-app-controls-toggle')).toBeTruthy();
  const doc = frame.contentDocument!, view = frame.contentWindow!;
  expect(view.getComputedStyle(doc.querySelector('#fallback-icon')!).display).toBe('none');
  const identity = doc.querySelector('.app-identity')!.getBoundingClientRect();
  const title = doc.querySelector('h1')!.getBoundingClientRect();
  expect(title.top - identity.bottom).toBeGreaterThanOrEqual(20);
  for (const state of ['disconnected', 'waiting', 'captureUnavailable', 'permissionRequired', 'sessionUnavailable', 'sessionFailed']) {
    doc.body.dataset.state = state;
    doc.querySelector('#connection')!.setAttribute('aria-busy', 'false');
    expect(view.getComputedStyle(doc.querySelector('.progress')!).display).toBe('none');
  }
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


it.each([
  ['application_exited', 'applicationExited'],
  ['windows_closed', 'windowsClosed'],
  ['sharing_stopped', 'sharingStopped'],
])('presents a completed %s session without connection motion or capture controls', async (reason, state) => {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width:390px;height:420px;border:0';
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(enUS.hostApplications)) {
    const name = key.startsWith('mac') ? key[3].toLowerCase() + key.slice(4) : key;
    if (typeof value === 'string') copy[name] = value;
  }
  frame.srcdoc = viewerHTML.replaceAll('{{.Locale}}', 'en-US').replaceAll('{{.Name}}', 'Text Editor')
    .replaceAll('{{.Nonce}}', 'fixture').replace('{{.Style}}', viewerCSS)
    .replace('{{.Config}}', JSON.stringify({base:'/fixture',copy,initial:{state:'ended',end_reason:reason}}))
    .replace('{{.Script}}', `window.redevenHostApplicationWindow = {request() {}}; window.fetch = () => { throw Error('Terminal document must not reconnect'); };\n${connectionJS}\n${viewerJS}`);
  document.body.append(frame);
  await expect.poll(() => frame.contentDocument?.body.dataset.state).toBe(state);
  const doc = frame.contentDocument!, view = frame.contentWindow!;
  expect(doc.querySelector('#status')!.textContent).toBe(copy[state]);
  expect(doc.querySelector('#hint')!.textContent).toBe(copy[state + 'Hint']);
  expect(view.getComputedStyle(doc.querySelector('.progress')!).display).toBe('none');
  expect(view.getComputedStyle(doc.querySelector('#retry')!).display).toBe('none');
  expect(view.getComputedStyle(doc.querySelector('.mac-app-controls')!).display).toBe('none');
  const dismiss = doc.querySelector<HTMLButtonElement>('#dismiss')!;
  expect(dismiss.textContent).toBe(copy.dismiss);
  expect(view.getComputedStyle(dismiss).cursor).toBe('pointer');
  expect(dismiss.getBoundingClientRect().bottom).toBeLessThan(420);
  expect(doc.body.scrollWidth).toBe(390);
});

it.each([390, 1000])('keeps the counted window picker usable at %s px while switching real viewer bindings', async width => {
  const frame = document.createElement('iframe');
  frame.style.cssText = `width:${width}px;height:500px;border:0`;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(enUS.hostApplications)) {
    const name = key.startsWith('mac') ? key[3].toLowerCase() + key.slice(4) : key;
    if (typeof value === 'string') copy[name] = value;
  }
  const fixture = `
    window.fetch = async () => ({ok:true,json:async () => ({state:'running',password:'fixture'})});
    window.createImageBitmap = async () => Object.assign(document.createElement('canvas'), {close() {}});
    window.WebSocket = class {
      static OPEN = 1; readyState = 1; generation = 0;
      constructor() { queueMicrotask(() => {
        this.onmessage({data:JSON.stringify({type:'windows',windows:[{id:'one',title:'Document A — a long host-provided title that must remain readable'},{id:'two',title:'Document B'}]})});
        this.window('one');
      }); }
      window(id) {
        const generation = ++this.generation;
        this.onmessage({data:JSON.stringify({type:'window',window:id,generation,width:640,height:480})});
        const header = new TextEncoder().encode(JSON.stringify({codec:'jpeg',generation,frame_id:generation}));
        const packet = new Uint8Array(4 + header.length + 1);
        new DataView(packet.buffer).setUint32(0,header.length); packet.set(header,4);
        this.onmessage({data:packet.buffer});
      }
      send(raw) { const value = JSON.parse(raw); if (value.action === 'select') this.window(value.window); }
      close() {}
    };
  `;
  frame.srcdoc = viewerHTML.replaceAll('{{.Locale}}', 'en-US').replaceAll('{{.Name}}', 'Text Editor')
    .replaceAll('{{.Nonce}}', 'fixture').replace('{{.Style}}', viewerCSS)
    .replace('{{.Config}}', JSON.stringify({base:window.location.origin+'/fixture',copy}))
    .replace('{{.Script}}', `${fixture}\n${connectionJS}\n${viewerJS}`);
  document.body.append(frame);
  await expect.poll(() => frame.contentDocument?.body.dataset.state).toBe('active');
  const doc = frame.contentDocument!, view = frame.contentWindow!;
  const toggle = doc.querySelector<HTMLButtonElement>('.mac-app-windows-toggle')!;
  expect(toggle.hidden).toBe(false);
  expect(toggle.textContent).toBe('2');
  toggle.click();
  const drawer = doc.querySelector<HTMLElement>('.mac-app-drawer')!;
  await Promise.all(drawer.getAnimations().map(animation => animation.finished));
  const list = doc.querySelector<HTMLElement>('.mac-app-window-list')!;
  expect(doc.querySelector<HTMLElement>('.mac-app-picture')!.hidden).toBe(true);
  expect(list.textContent).toContain('long host-provided title');
  const second = list.querySelectorAll<HTMLButtonElement>('button')[1];
  second.click();
  await expect.poll(() => second.getAttribute('aria-busy')).toBe('false');
  expect(second.getAttribute('aria-pressed')).toBe('true');
  expect(drawer.hidden).toBe(false);
  expect(drawer.getBoundingClientRect().right).toBeLessThan(width);
  expect(drawer.scrollWidth).toBe(drawer.clientWidth);
  expect(view.getComputedStyle(second).cursor).toBe('pointer');
  second.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}));
  expect(drawer.hidden).toBe(true);
  expect(doc.activeElement).toBe(toggle);
});
