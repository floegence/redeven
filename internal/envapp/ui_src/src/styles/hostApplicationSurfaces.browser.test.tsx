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
import toolbarJS from '../../../../codeapp/appserver/host_application_viewer/toolbar.js?raw';
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

it.each([320, 390, 1000].flatMap(width => ['light', 'dark'].map(scheme => ({width,scheme}))))('keeps toolbar settings usable at $width px in $scheme appearance', async ({width,scheme}) => {
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
    .replace('{{.Script}}', `window.fetch = () => new Promise(() => {});\n${connectionJS}\n${toolbarJS}\n${viewerJS}`);
  document.body.append(frame);
  await expect.poll(() => frame.contentDocument?.querySelector('.mac-app-controls-toggle')).toBeTruthy();
  const doc = frame.contentDocument!, view = frame.contentWindow!;
  doc.documentElement.style.colorScheme = scheme;
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
  const drawer = doc.querySelector<HTMLElement>('.mac-app-popover')!;
  expect(drawer.hidden).toBe(true);
  expect(toggle.getBoundingClientRect().top).toBeLessThan(16);
  expect(doc.querySelector('.mac-app-toolbar')!.getBoundingClientRect().bottom).toBeLessThanOrEqual(46);
  toggle.disabled = false;
  toggle.click();
  await Promise.all(drawer.getAnimations().map(animation => animation.finished));
  const bounds = drawer.getBoundingClientRect();
  expect(bounds.left).toBeGreaterThanOrEqual(8);
  expect(bounds.right).toBeLessThan(width);
  expect(bounds.top).toBeGreaterThanOrEqual(46);
  expect(bounds.bottom).toBeLessThanOrEqual(650);
  expect(drawer.scrollWidth).toBeLessThanOrEqual(drawer.clientWidth);
  const advanced = doc.querySelector<HTMLDetailsElement>('.mac-app-picture details')!;
  advanced.open = true;
  expect(drawer.scrollWidth).toBeLessThanOrEqual(drawer.clientWidth);
  for (const select of advanced.querySelectorAll('select')) {
    expect(select.getBoundingClientRect().right).toBeLessThan(bounds.right);
    expect(view.getComputedStyle(select).cursor).toBe('pointer');
  }
  // A short viewport scrolls the settings, never the host application surface.
  frame.style.height = '300px';
  expect(drawer.getBoundingClientRect().bottom).toBeLessThanOrEqual(292);
  expect(drawer.scrollHeight).toBeGreaterThan(drawer.clientHeight);
  frame.style.height = '660px';
  const canvas = doc.querySelector('#application')!.getBoundingClientRect();
  expect(canvas.width).toBe(width);
  expect(canvas.top).toBe(46);
  expect(canvas.height).toBe(614);
  expect(doc.querySelector('.mac-app-toolbar')!.scrollWidth).toBeLessThanOrEqual(width);
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
    .replace('{{.Script}}', `window.redevenHostApplicationWindow = {request() {}}; window.fetch = () => { throw Error('Terminal document must not reconnect'); };\n${connectionJS}\n${toolbarJS}\n${viewerJS}`);
  document.body.append(frame);
  await expect.poll(() => frame.contentDocument?.body.dataset.state).toBe(state);
  const doc = frame.contentDocument!, view = frame.contentWindow!;
  expect(doc.querySelector('#status')!.textContent).toBe(copy[state]);
  expect(doc.querySelector('#hint')!.textContent).toBe(copy[state + 'Hint']);
  expect(view.getComputedStyle(doc.querySelector('.progress')!).display).toBe('none');
  expect(view.getComputedStyle(doc.querySelector('#retry')!).display).toBe('none');
  expect(view.getComputedStyle(doc.querySelector('.mac-app-controls')!).display).not.toBe('none');
  expect([...doc.querySelectorAll<HTMLButtonElement>('.mac-app-toolbar button')].every(button => button.disabled)).toBe(true);
  const dismiss = doc.querySelector<HTMLButtonElement>('#dismiss')!;
  expect(dismiss.textContent).toBe(copy.dismiss);
  expect(view.getComputedStyle(dismiss).cursor).toBe('pointer');
  expect(dismiss.getBoundingClientRect().bottom).toBeLessThan(420);
  expect(doc.body.scrollWidth).toBe(390);
});

it.each([320, 390, 1000])('keeps the counted window picker usable at %s px while switching real viewer bindings', async width => {
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
    .replace('{{.Script}}', `${fixture}\n${connectionJS}\n${toolbarJS}\n${viewerJS}`);
  document.body.append(frame);
  await expect.poll(() => frame.contentDocument?.body.dataset.state).toBe('active');
  const doc = frame.contentDocument!, view = frame.contentWindow!;
  const toggle = doc.querySelector<HTMLButtonElement>('.mac-app-windows-toggle')!;
  expect(toggle.hidden).toBe(false);
  const toolbar = doc.querySelector<HTMLElement>('.mac-app-toolbar')!;
  expect(toolbar.scrollWidth).toBeLessThanOrEqual(width);
  for (const button of toolbar.querySelectorAll('button')) {
    const bounds = button.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(width);
    expect(bounds.width).toBeGreaterThanOrEqual(32);
    expect(bounds.height).toBeGreaterThanOrEqual(32);
  }
  const menu = doc.querySelector<HTMLButtonElement>('.mac-app-menu-toggle')!;
  expect(menu.getBoundingClientRect().right).toBeLessThanOrEqual(toggle.getBoundingClientRect().left);
  expect(toggle.getBoundingClientRect().right).toBeLessThanOrEqual(doc.querySelector('.mac-app-controls-toggle')!.getBoundingClientRect().left);
  expect(toggle.textContent).toContain('2');
  toggle.click();
  const drawer = doc.querySelector<HTMLElement>('.mac-app-popover')!;
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
  const quit = doc.querySelector<HTMLButtonElement>('.mac-app-quit')!;
  quit.click();
  await Promise.all(drawer.getAnimations().map(animation => animation.finished));
  const confirmation = doc.querySelector<HTMLElement>('.mac-app-quit-confirmation')!;
  expect(confirmation.hidden).toBe(false);
  expect(drawer.getBoundingClientRect().left).toBeGreaterThanOrEqual(8);
  expect(drawer.getBoundingClientRect().right).toBeLessThan(width);
  expect(drawer.scrollWidth).toBe(drawer.clientWidth);
  expect(doc.activeElement).toBe(confirmation.querySelector('button'));
});

it('decodes and acknowledges a single static native video frame without waiting for another frame', async () => {
  // A synthetic 64 x 64 gray BGRA buffer encoded by VideoToolbox with the
  // production Main profile. This contains no application or screen content.
  const encoded = {
  "data" : "AAAAOgYFMkdWStxcTEM/lO/FETzRQ6gBAAADAAEDAAADAAECAAHmAAsAAAMAAAMAAE5IDAOJJAEN/////4AAAAA6JbggH7gVW9P/EJ/VBnkzaLpABEAeFp4akvq+1cKpsULmIwv1FMlK2qWN574AABXUMqW8AWe7fMTZbA==",
  "description" : "AU0AC//hAAsnTQALq0GG8CDCKAEABCjuPIA=",
  "profile" : "avc1.4D000B"
};
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width:640px;height:480px;border:0';
  const fixture = `
    const encoded = ${JSON.stringify(encoded)};
    window.fetch = async () => ({ok:true,json:async () => ({state:'running',password:'fixture'})});
    window.WebSocket = class {
      static OPEN = 1; readyState = 1;
      constructor() { queueMicrotask(() => this.onopen()); }
      send(raw) {
        const message = JSON.parse(raw);
        if (message.action === 'frame_ack') document.body.dataset.ack = String(message.frame_id);
        if (message.action !== 'resume') return;
        document.body.dataset.video = String(message.video);
        this.onmessage({data:JSON.stringify({type:'window',window:'one',generation:1,width:64,height:64})});
        const header = new TextEncoder().encode(JSON.stringify({codec:'h264',key:true,transport:'video',generation:1,frame_id:1,timestamp:0,profile:encoded.profile,description:encoded.description}));
        const bytes = Uint8Array.from(atob(encoded.data), ch => ch.charCodeAt(0));
        const packet = new Uint8Array(4 + header.length + bytes.length);
        new DataView(packet.buffer).setUint32(0,header.length); packet.set(header,4); packet.set(bytes,4+header.length);
        this.onmessage({data:packet.buffer});
      }
      close() { this.readyState = 3; }
    };
  `;
  frame.srcdoc = viewerHTML.replaceAll('{{.Locale}}', 'en-US').replaceAll('{{.Name}}', 'Decoder Fixture')
    .replaceAll('{{.Nonce}}', 'fixture').replace('{{.Style}}', viewerCSS)
    .replace('{{.Config}}', JSON.stringify({base:window.location.origin+'/fixture',copy:{}}))
    .replace('{{.Script}}', `${fixture}\n${connectionJS}\n${toolbarJS}\n${viewerJS}`);
  document.body.append(frame);
  await expect.poll(() => frame.contentDocument?.body.dataset.video).toBe('true');
  await expect.poll(() => frame.contentDocument?.body.dataset.ack, {timeout:2000}).toBe('1');
  const doc = frame.contentDocument!;
  expect(doc.body.dataset.state).toBe('active');
  const canvas = doc.querySelector('canvas')!;
  expect(canvas.width).toBe(64);
  const pixel = canvas.getContext('2d')!.getImageData(32,32,1,1).data;
  expect(pixel[0]).toBeGreaterThan(60);
  expect(pixel[0]).toBeLessThan(100);
});


it.each([
  {platform:'macOS', width:520, start:84, end:16, scheme:'light'},
  {platform:'macOS', width:1200, start:84, end:16, scheme:'dark'},
  {platform:'macOS fullscreen', width:520, start:16, end:16, scheme:'light'},
  {platform:'Windows', width:520, start:16, end:144, scheme:'light'},
  {platform:'Linux', width:520, start:16, end:136, scheme:'dark'},
])('integrates the toolbar into $platform native chrome at $width px', async ({width,start,end,scheme}) => {
  const frame = document.createElement('iframe'); frame.style.cssText = `width:${width}px;height:500px;border:0`;
  const copy: Record<string, unknown> = {};
  for (const [key,value] of Object.entries(enUS.hostApplications)) {
    if (typeof value === 'string') copy[key.startsWith('mac') ? key[3].toLowerCase() + key.slice(4) : key] = value;
  }
  const native = `window.redevenHostApplicationWindow = {request() {}};
    document.documentElement.dataset.redevenHostApplicationChrome = 'true';
    document.documentElement.style.setProperty('--redeven-desktop-titlebar-height', '40px');
    document.documentElement.style.setProperty('--redeven-desktop-titlebar-start-inset', '${start}px');
    document.documentElement.style.setProperty('--redeven-desktop-titlebar-end-inset', '${end}px');
    window.fetch = () => new Promise(() => {});`;
  frame.srcdoc = viewerHTML.replaceAll('{{.Locale}}','en-US').replaceAll('{{.Name}}','Text Editor')
    .replaceAll('{{.Nonce}}','fixture').replace('{{.Style}}',viewerCSS)
    .replace('{{.Config}}',JSON.stringify({base:'/fixture',copy,icon:''}))
    .replace('{{.Script}}', `${native}\n${connectionJS}\n${toolbarJS}\n${viewerJS}`);
  document.body.append(frame);
  await expect.poll(() => frame.contentDocument?.querySelector('.mac-app-toolbar')).toBeTruthy();
  const doc=frame.contentDocument!, view=frame.contentWindow!;
  doc.documentElement.style.colorScheme=scheme;
  const toolbar=doc.querySelector<HTMLElement>('.mac-app-toolbar')!;
  expect(doc.querySelector('.mac-app-controls')!.getBoundingClientRect().height).toBe(40);
  expect(view.getComputedStyle(doc.querySelector('.mac-app-controls')!).display).not.toBe('none');
  expect(toolbar.scrollWidth).toBeLessThanOrEqual(width);
  for (const button of toolbar.querySelectorAll<HTMLButtonElement>('button')) {
    const bounds=button.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(start);
    expect(bounds.right).toBeLessThanOrEqual(width-end);
    expect(bounds.top).toBeGreaterThanOrEqual(0); expect(bounds.bottom).toBeLessThanOrEqual(40);
  }
  expect(doc.querySelector('#application')!.getBoundingClientRect().top).toBe(40);
  const picture=doc.querySelector<HTMLButtonElement>('.mac-app-controls-toggle')!;
  picture.disabled=false; picture.click();
  const popover=doc.querySelector<HTMLElement>('.mac-app-popover')!;
  await Promise.all(popover.getAnimations().map(animation=>animation.finished));
  expect(popover.getBoundingClientRect().top).toBeGreaterThanOrEqual(40);
  expect(popover.getBoundingClientRect().right).toBeLessThanOrEqual(width-8);
  expect(view.getComputedStyle(picture).cursor).toBe('pointer');
});
