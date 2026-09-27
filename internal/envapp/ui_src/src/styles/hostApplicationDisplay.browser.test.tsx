import '../index.css';
import { afterEach, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import viewerHTML from '../../../../codeapp/appserver/host_application_viewer/viewer.html?raw';
import viewerCSS from '../../../../codeapp/appserver/host_application_viewer/viewer.css?raw';
import appearanceCSS from '../../../../codeapp/appserver/host_application_viewer/appearance.generated.css?raw';
import catalogJS from '../../../../codeapp/appserver/host_application_viewer/catalog.generated.js?raw';
import appearanceJS from '../../../../codeapp/appserver/host_application_viewer/appearance.js?raw';
import connectionJS from '../../../../codeapp/appserver/host_application_viewer/connection.js?raw';
import toolbarJS from '../../../../codeapp/appserver/host_application_viewer/toolbar.js?raw';
import inputJS from '../../../../codeapp/appserver/host_application_viewer/remote-input.generated.js?raw';
import pointerJS from '../../../../codeapp/appserver/host_application_viewer/remote-pointer.generated.js?raw';
import viewerJS from '../../../../codeapp/appserver/host_application_viewer/viewer.js?raw';

const catalog = JSON.parse(catalogJS.slice(catalogJS.indexOf(' = ') + 3).trim().slice(0, -1)) as {
  locales: Record<string, Record<string, string>>;
};
const fixtureCommands = commands as unknown as {hostApplicationDisplayFixture: (html: string | null) => Promise<void>; typeHostApplicationDisplayContent: (activation: 'pixels' | 'keyboard') => Promise<void>};
type DisplayState = {available:boolean; policy:string; density:number; width:number; height:number; limit:null | 'display' | 'density'};
type Fixture = Window & {client: {do_send_damage_sequence: (...args: unknown[]) => void}; emitDisplay: (state: Partial<DisplayState>) => void; controlsSent:number; refreshes:number; closes:number; keys:{key:string;pressed:boolean}[]};

afterEach(async () => { document.body.replaceChildren(); await fixtureCommands.hostApplicationDisplayFixture(null); await page.viewport(1280,800); });

async function viewer(width: number, theme: string, locale = 'en-US') {
  await page.viewport(width + 24, 660);
  await fixtureCommands.hostApplicationDisplayFixture(`<!doctype html><html><body><div id="screen"></div><script>
    const noop=()=>{};let notify=noop;
    let state={available:true,policy:'logical',density:1,width:2200,height:1254,limit:null};
    window.controlsSent=0;window.refreshes=0;window.closes=0;window.keys=[];
    const canvas=document.createElement('canvas');canvas.dataset.hostDisplayFixture='';canvas.width=640;canvas.height=480;document.getElementById('screen').append(canvas);
    const div=document.createElement('div');document.getElementById('screen').append(div);
    const win={wid:1,div,metadata:{title:'Text editor'},windowtype:['NORMAL'],
      override_redirect:false,tray:false,has_windowtype:types=>types.includes('NORMAL'),
      screen_resized:noop,set_maximized:noop,set_minimized:noop,initiate_moveresize:noop,
      move_resize:noop,update_metadata:noop,destroy:noop,handle_resized:noop};
    const target={wid:1,window:win};
    window.client={connected:true,scale:1,focused_wid:1,supported_encodings:['h264'],id_to_window:{1:win},
      floeInput:{version:1,target:null,bindTarget(value){this.target=value?target:null;return this.target},commitText:noop,sendKey:key=>window.keys.push(key),release:noop,clipboard:noop,paste:noop},
      floePointer:{version:1,targetForWindow:()=>target,resolveTarget:()=>target,isTargetValid:()=>true,sendPointer:()=>true,release:noop},
      _new_window:noop,do_send_damage_sequence:noop,send_configure_window:noop,_get_desktop_size:()=>[state.width,state.height],
      set_window_layout:noop,
      set_display_density(policy){state={...state,policy};notify(state);return true},
      subscribe_display(listener){notify=listener;notify(state);return()=>{notify=noop}},
      send(){window.controlsSent++},send_control_refresh(){window.refreshes++},
      send_close_window:noop,set_focus:noop,close(){window.closes++},on_last_window:noop};
    window.emitDisplay=next=>{state={...state,...next};notify(state)};
    window.floeXpraViewer={version:1,getClient:()=>window.client,capabilities:()=>({display:state.available?'native':'logical',input:'ready',pointer:'ready'})};
  </script></body></html>`);
  const frame = document.createElement('iframe');
  frame.style.cssText = `width:${width}px;height:620px;border:0`;
  const copy = {...catalog.locales[locale], locale, shellTheme:theme, pictureHint:catalog.locales[locale].sessionPictureHint};
  frame.srcdoc = viewerHTML.replaceAll('{{.Locale}}', locale).replaceAll('{{.Theme}}', theme).replaceAll('{{.Name}}', 'Text editor')
    .replaceAll('{{.Nonce}}', 'fixture').replace('{{.Style}}', appearanceCSS + '\n' + viewerCSS)
    .replace('{{.Config}}', JSON.stringify({base:'/__host_display_fixture__', backend:'xpra', copy}))
    .replace('{{.Script}}', ['window.fetch=async()=>({ok:true,json:async()=>({state:"running",password:"fixture"})});', inputJS, pointerJS, catalogJS, appearanceJS, connectionJS, toolbarJS, viewerJS].join('\n'));
  document.body.append(frame);
  await expect.poll(() => frame.contentDocument?.querySelector<HTMLIFrameElement>('#application')?.contentDocument?.querySelector('.floe-remote-input')).toBeTruthy();
  const doc = frame.contentDocument!, view = frame.contentWindow!;
  const runtime = doc.querySelector<HTMLIFrameElement>('#application')!.contentWindow as Fixture;
  runtime.client.do_send_damage_sequence(1, 1, 100, 100, 10, '');
  await expect.poll(() => doc.body.dataset.state).toBe('active');
  const toggle = doc.querySelector<HTMLButtonElement>('.mac-app-controls-toggle')!;
  toggle.click();
  await Promise.all(doc.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished));
  doc.querySelector<HTMLButtonElement>('[data-picture-mode="clarity"]')!.click();
  runtime.emitDisplay({policy:'native', limit:'display'});
  return {doc, view, frame, runtime, toggle};
}

it.each([320, 390, 1280].flatMap(width => ['porcelain-light', 'porcelain-dark'].map(theme => ({width,theme}))))('presents actionable display limits at $width px in $theme', async ({width,theme}) => {
  const {doc,view,frame,runtime,toggle} = await viewer(width,theme,'zh-CN');
  const notice = doc.querySelector<HTMLElement>('.host-app-display-notice')!;
  expect(notice.hidden).toBe(false);
  expect(notice.textContent).toContain(catalog.locales['zh-CN'].pictureDisplayLimitHint);
  expect(doc.querySelector('.host-app-render-resolution')!.textContent).toBe('2,200 × 1,254');
  const popover = doc.querySelector<HTMLElement>('.mac-app-popover')!;
  expect(popover.scrollWidth).toBeLessThanOrEqual(popover.clientWidth);
  expect(popover.getBoundingClientRect().left).toBeGreaterThanOrEqual(8);
  expect(popover.getBoundingClientRect().right).toBeLessThanOrEqual(width-8);
  for (const button of popover.querySelectorAll<HTMLButtonElement>('.mac-app-picture-modes button')) {
    expect(view.getComputedStyle(button).cursor).toBe('pointer');
    expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth);
  }
  const sent=runtime.controlsSent, refreshed=runtime.refreshes;
  runtime.emitDisplay({density:2,width:2560,height:1508,limit:null});
  expect(notice.hidden).toBe(true);
  expect(view.getComputedStyle(notice).display).toBe('none');
  expect(runtime.controlsSent).toBe(sent);expect(runtime.refreshes).toBe(refreshed);
  frame.style.height='260px';
  await expect.poll(() => popover.getBoundingClientRect().bottom).toBeLessThanOrEqual(252);
  expect(popover.scrollHeight).toBeGreaterThan(popover.clientHeight);
  const clarity=doc.querySelector<HTMLButtonElement>('[data-picture-mode="clarity"]')!;
  clarity.focus(); await userEvent.keyboard('{Escape}');
  expect(popover.hidden).toBe(true);expect(doc.activeElement).toBe(toggle);
  expect(runtime.closes).toBe(0);
});

it.each(Object.keys(catalog.locales))('keeps display feedback readable and reactive in %s', async locale => {
  const {doc,runtime} = await viewer(320,'porcelain-light',locale);
  const sent=runtime.controlsSent, refreshed=runtime.refreshes;
  const popover=doc.querySelector<HTMLElement>('.mac-app-popover')!;
  expect(popover.scrollWidth).toBeLessThanOrEqual(popover.clientWidth);
  expect(doc.querySelector('.host-app-display-notice')!.textContent).toContain(catalog.locales[locale].pictureDisplayLimitHint);
  runtime.emitDisplay({limit:'density'});
  expect(doc.querySelector('.host-app-display-notice')!.textContent).toContain(catalog.locales[locale].pictureDensityLimitHint);
  doc.documentElement.lang='ja-JP';
  await expect.poll(() => doc.querySelector('.host-app-display-notice')!.textContent).toContain(catalog.locales['ja-JP'].pictureDensityLimitHint);
  expect(runtime.controlsSent).toBe(sent);expect(runtime.refreshes).toBe(refreshed);
});

it.each(['pixels', 'keyboard'] as const)('returns keyboard focus from picture controls through %s', async activation => {
  const {doc, runtime, toggle} = await viewer(900, 'porcelain-light');
  toggle.click();
  toggle.focus();
  expect(doc.activeElement).toBe(toggle);
  await fixtureCommands.typeHostApplicationDisplayContent(activation);
  const content = doc.querySelector<HTMLIFrameElement>('#application')!.contentDocument!;
  expect(content.activeElement).toBe(content.querySelector('.floe-remote-input'));
  expect(runtime.keys.map(key => [key.key, key.pressed])).toEqual([
    ['a', true], ['a', false], ['b', true], ['b', false], ['c', true], ['c', false],
  ]);
});
