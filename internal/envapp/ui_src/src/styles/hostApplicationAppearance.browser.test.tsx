import '../index.css';
import { afterEach, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import floeCSS from '@floegence/floe-webapp-core/styles?raw';
import viewerHTML from '../../../../codeapp/appserver/host_application_viewer/viewer.html?raw';
import viewerCSS from '../../../../codeapp/appserver/host_application_viewer/viewer.css?raw';
import appearanceCSS from '../../../../codeapp/appserver/host_application_viewer/appearance.generated.css?raw';
import viewportJS from '../../../../codeapp/appserver/host_application_viewer/viewport.generated.js?raw';
import catalogJS from '../../../../codeapp/appserver/host_application_viewer/catalog.generated.js?raw';
import appearanceJS from '../../../../codeapp/appserver/host_application_viewer/appearance.js?raw';
import connectionJS from '../../../../codeapp/appserver/host_application_viewer/connection.js?raw';
import toolbarJS from '../../../../codeapp/appserver/host_application_viewer/toolbar.js?raw';
import inputJS from '../../../../codeapp/appserver/host_application_viewer/remote-input.generated.js?raw';
import pointerJS from '../../../../codeapp/appserver/host_application_viewer/remote-pointer.generated.js?raw';
import inputCSS from '../../../../codeapp/appserver/host_application_viewer/remote-input.generated.css?raw';
import pointerCSS from '../../../../codeapp/appserver/host_application_viewer/remote-pointer.generated.css?raw';
import viewerJS from '../../../../codeapp/appserver/host_application_viewer/macos.js?raw';

const catalog = JSON.parse(catalogJS.slice(catalogJS.indexOf(' = ') + 3).trim().slice(0, -1)) as {
  defaults: Record<string, string>; locales: Record<string, Record<string, string>>;
};
const media = commands as unknown as {emulateMediaPreferences: (preferences: {forcedColors:'active' | 'none'}) => Promise<void>};
afterEach(async () => { document.body.replaceChildren(); await media.emulateMediaPreferences({forcedColors:'none'}); });

async function viewer(theme: string, locale = 'zh-CN', width = 420) {
  const frame = document.createElement('iframe');
  frame.style.cssText = `width:${width}px;height:660px;border:0`;
  const copy = {...catalog.locales[locale], locale, shellTheme:theme, quitTitle:catalog.locales[locale].quitTitle.replaceAll('{name}', 'Text Editor')};
  const fixture = `
    window.fetchCount=0;window.socketCount=0;window.sent=[];
    window.fetch=async()=>{window.fetchCount++;return {ok:true,json:async()=>({state:'running',password:'fixture'})}};
    window.createImageBitmap=async()=>Object.assign(document.createElement('canvas'),{close(){}});
    window.WebSocket=class {
      static OPEN=1;readyState=1;
      constructor(){window.socketCount++;queueMicrotask(()=>{
        this.onmessage({data:JSON.stringify({type:'windows',windows:[{id:'one',title:'Research notes'},{id:'two',title:'Project brief'}]})});
        this.onmessage({data:JSON.stringify({type:'window',input_version:1,window:'one',generation:1,width:640,height:480})});
        const header=new TextEncoder().encode(JSON.stringify({codec:'jpeg',generation:1,frame_id:1}));
        const packet=new Uint8Array(4+header.length+1);new DataView(packet.buffer).setUint32(0,header.length);packet.set(header,4);
        this.onmessage({data:packet.buffer});
      });}
      send(value){window.sent.push(JSON.parse(value))}close(){}
    };`;
  frame.srcdoc = viewerHTML.replaceAll('{{.Locale}}', locale).replaceAll('{{.Theme}}', theme).replaceAll('{{.Name}}', 'Text Editor')
    .replaceAll('{{.Nonce}}', 'fixture').replace('{{.Style}}', appearanceCSS + '\n' + inputCSS + '\n' + pointerCSS + '\n' + viewerCSS)
    .replace('{{.Config}}', JSON.stringify({base:window.location.origin+'/fixture',backend:'macos',copy}))
    .replace('{{.Script}}', [fixture, inputJS, pointerJS, viewportJS, catalogJS, appearanceJS, connectionJS, toolbarJS, viewerJS].join('\n'));
  document.body.append(frame);
  await expect.poll(() => frame.contentDocument?.body.dataset.state).toBe('active');
  const doc = frame.contentDocument!, view = frame.contentWindow!;
  const toggle = doc.querySelector<HTMLButtonElement>('.mac-app-controls-toggle')!;
  toggle.click();
  await Promise.all(doc.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
  return {doc,view,frame,toggle};
}

it.each(builtInShellThemePresets)('matches Env App colors and floating material in $name', async preset => {
  const {doc,view,toggle} = await viewer(preset.name);
  const reference = document.createElement('iframe');
  reference.srcdoc = `<html class="${preset.mode}" data-floe-shell-theme="${preset.name}" data-floe-surface-style="soft-neumorphic"><style>${floeCSS}</style><body><div id="reference" data-floe-surface="floating" style="background:var(--background);color:var(--muted-foreground);border:1px solid var(--border)"></div><div id="primary" style="background:var(--primary);color:var(--primary-foreground)"></div></body></html>`;
  document.body.append(reference);
  await new Promise(resolve => reference.onload = resolve);
  const canonical = reference.contentWindow!.getComputedStyle(reference.contentDocument!.querySelector('#reference')!);
  expect(view.getComputedStyle(doc.querySelector('.mac-app-controls')!).backgroundColor).toBe(canonical.backgroundColor);
  // The opened button uses the theme's active state; the close button stays neutral.
  expect(view.getComputedStyle(doc.querySelector('.mac-app-close')!).color).toBe(canonical.color);
  expect(view.getComputedStyle(doc.querySelector('.mac-app-popover')!).boxShadow).toBe(canonical.boxShadow);
  const selected = doc.querySelector('[data-picture-mode="auto"]')!;
  const primary = reference.contentWindow!.getComputedStyle(reference.contentDocument!.querySelector('#primary')!);
  expect(view.getComputedStyle(selected).backgroundColor).toBe(primary.backgroundColor);
  expect(view.getComputedStyle(selected).color).toBe(primary.color);
  expect(doc.documentElement.classList.contains(preset.mode!)).toBe(true);
  const popover = doc.querySelector<HTMLElement>('.mac-app-popover')!;
  expect(popover.scrollWidth).toBeLessThanOrEqual(popover.clientWidth);
  expect(popover.getBoundingClientRect().right).toBeLessThanOrEqual(412);
  const select = doc.querySelector<HTMLSelectElement>('.mac-app-picture select')!;
  doc.querySelector<HTMLDetailsElement>('.mac-app-picture details')!.open = true;
  select.focus();
  const inputStyle = view.getComputedStyle(select);
  expect(inputStyle.boxShadow).toBe('none');
  expect(inputStyle.outlineStyle).toBe('none');
  toggle.focus();
  doc.documentElement.dataset.floeShellTheme = preset.mode === 'light' ? catalog.defaults.dark : catalog.defaults.light;
  await expect.poll(() => doc.documentElement.classList.contains(preset.mode!)).toBe(false);
  expect(doc.activeElement).toBe(toggle);
  expect(doc.querySelector('.mac-app-controls-toggle')).toBe(toggle);
  expect((view as unknown as {socketCount:number}).socketCount).toBe(1);
});

it.each(Object.keys(catalog.locales))('updates visible copy and accessibility in %s without reconnecting', async locale => {
  const {doc,view,toggle} = await viewer(catalog.defaults.light, 'en-US', 360);
  const preset = doc.querySelector<HTMLButtonElement>('[data-picture-mode="clarity"]')!;
  preset.click(); toggle.focus();
  const runtime = view as unknown as {fetchCount:number;socketCount:number;sent:unknown[]};
  const sent = runtime.sent.length;
  doc.documentElement.lang = locale;
  await expect.poll(() => toggle.title).toBe(catalog.locales[locale].picture);
  for (const attribute of [null, 'title', 'aria-label']) {
    const binding = 'data-app-copy' + (attribute ? '-' + attribute : '');
    for (const element of doc.querySelectorAll(`[${binding}]`)) {
      const key = element.getAttribute(binding)!;
      const expected = catalog.locales[locale][key].replaceAll('{name}', 'Text Editor');
      expect(attribute ? element.getAttribute(attribute) : element.textContent, `${locale}:${key}`).toBe(expected);
    }
  }
  expect(doc.activeElement).toBe(toggle);
  expect(doc.querySelector('[data-picture-mode="clarity"]')).toBe(preset);
  expect(preset.getAttribute('aria-pressed')).toBe('true');
  expect(runtime.fetchCount).toBe(1); expect(runtime.socketCount).toBe(1); expect(runtime.sent.length).toBe(sent);
  const advanced = doc.querySelector<HTMLDetailsElement>('.mac-app-picture details')!;
  advanced.open = true;
  const popover = doc.querySelector<HTMLElement>('.mac-app-popover')!;
  expect(popover.scrollWidth).toBeLessThanOrEqual(popover.clientWidth);
  for (const button of popover.querySelectorAll('button')) expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth);
  toggle.click(); doc.querySelector<HTMLButtonElement>('.mac-app-quit')!.click();
  expect(doc.querySelector('.mac-app-quit-confirmation strong')!.textContent).toBe(catalog.locales[locale].quitTitle.replaceAll('{name}', 'Text Editor'));
  expect(popover.scrollWidth).toBeLessThanOrEqual(popover.clientWidth);
  expect(doc.querySelector('.mac-app-confirm-quit')!.getBoundingClientRect().right).toBeLessThanOrEqual(352);
});

it('retains selected picture and keyboard focus cues in forced colors', async () => {
  await media.emulateMediaPreferences({forcedColors:'active'});
  const {doc,view} = await viewer(catalog.defaults.dark);
  const selected = doc.querySelector<HTMLButtonElement>('[data-picture-mode="auto"]')!;
  selected.focus();
  expect(view.getComputedStyle(selected).backgroundColor).not.toBe(view.getComputedStyle(selected).color);
  expect(view.getComputedStyle(selected).outlineStyle).not.toBe('none');
});
