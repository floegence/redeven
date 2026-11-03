import '../../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { TerminalHistorySettings } from './TerminalHistorySettings';
import { I18nProvider } from '../i18n/I18nProvider';
import { writeStoredLanguagePreference } from '../i18n/storage';
import type { RedevenLocale } from '../i18n/localeMeta';
import type { RedevenTerminalTransport } from '../services/terminalTransport';
const http = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../services/localApi', async () => ({ ...await vi.importActual('../services/localApi'), fetchLocalApiJSON: http.request }));
let cleanup: (() => void) | undefined;
afterEach(async () => { cleanup?.(); writeStoredLanguagePreference('en-US'); document.body.replaceChildren(); vi.resetAllMocks(); await page.viewport(1280,720); });
function mount(admin = true, locale?: RedevenLocale) {
 if (locale) writeStoredLanguagePreference(locale);
 const limits = { max_lines: 1000, max_bytes: 1048576 };
 const state = { configured: limits, effective: limits, defaults: limits };
 http.request.mockImplementation(async (_url: string, init: RequestInit) => init.method === 'GET' ? { supported: true, can_manage: admin, defaults: limits } : limits);
 const apply = vi.fn(async () => state), read = vi.fn(async () => state);
 const [sessionId, setSessionId] = createSignal('first');
 const host = document.createElement('div'); document.body.append(host);
 host.style.padding = '16px';
 const content = () => <TerminalHistorySettings open sessionId={sessionId()} transport={{ historyRetention: read, configureHistoryRetention: apply } as unknown as RedevenTerminalTransport} />;
 cleanup = render(() => locale ? <I18nProvider>{content()}</I18nProvider> : content(),host);
 return {host,apply,read,setSessionId};
}
describe('terminal history settings', () => {
 it.each(['en-US','zh-CN','zh-TW','ja-JP','ko-KR','de-DE','es-ES','fr-FR','pt-BR','ru-RU'] as RedevenLocale[])('keeps %s fields and confirmation usable at 320 pixels', async locale => {
  await page.viewport(320,800); const test = mount(true,locale);
  await expect.poll(()=>test.host.querySelectorAll('input').length).toBe(2);
  await expect.poll(()=>document.documentElement.lang).toBe(locale);
  test.host.querySelectorAll<HTMLButtonElement>('button')[1]!.click();
  await expect.poll(()=>test.host.querySelector('[role="alert"]')).not.toBeNull();
  for (const element of test.host.querySelectorAll<HTMLElement>('section, label, button, [role="alert"]')) {
   expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth+1);
   expect(element.getBoundingClientRect().right).toBeLessThanOrEqual(320);
  }
 });

 it('saves defaults separately and confirms application to one current session',async()=>{
  const test = mount();
  await expect.poll(()=>test.host.querySelectorAll('input').length).toBe(2);
  await page.getByRole('button',{name:'Save for new sessions'}).click();
  expect(test.apply).not.toHaveBeenCalled();
  expect(http.request).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({method:'PUT'}));
  await page.getByRole('button',{name:'Apply to current session',exact:true}).click();
  expect(test.apply).not.toHaveBeenCalled();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Apply to current session',exact:true}).click();
  test.setSessionId('second');
  await expect.poll(()=>test.host.querySelector('[role="alert"]')).toBeNull();
  expect(test.apply).not.toHaveBeenCalled();
  await page.getByRole('button',{name:'Apply to current session',exact:true}).click();
  const confirm = [...test.host.querySelectorAll<HTMLButtonElement>('button')].filter(button=>button.textContent?.includes('Apply to current session')).at(-1)!;
  confirm.click();
  await expect.poll(()=>test.apply.mock.calls.length).toBe(1);
  expect(test.apply).toHaveBeenCalledWith('second',{max_lines:1000,max_bytes:1048576});
 });
 it('blocks invalid input and administrator-only saves at mobile width',async()=>{
  await page.viewport(320,800);const test=mount(false);
  await expect.poll(()=>test.host.querySelectorAll('input').length).toBe(2);
  expect((test.host.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  const input=test.host.querySelector('input')!;input.value='-1';input.dispatchEvent(new InputEvent('input',{bubbles:true}));
  expect([...test.host.querySelectorAll('button')].every(button=>button.disabled)).toBe(true);
  expect(test.host.scrollWidth).toBeLessThanOrEqual(test.host.clientWidth+1);
 });
 it('does not retry an uncertain mutation and requires a fresh read',async()=>{
  const test=mount();await expect.poll(()=>test.host.querySelectorAll('input').length).toBe(2);
  http.request.mockRejectedValueOnce(new Error('lost response'));
  await page.getByRole('button',{name:'Save for new sessions'}).click();
  await expect.poll(()=>test.host.textContent).toContain('could not be confirmed');
  expect((test.host.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  expect(http.request.mock.calls.filter(call=>call[1].method==='PUT')).toHaveLength(1);
  await page.getByRole('button',{name:'Reload settings'}).click();
  await expect.poll(()=>(test.host.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
 });
 it('keeps a slow apply bound to its original session while the user switches',async()=>{
  const test=mount();await expect.poll(()=>test.host.querySelectorAll('input').length).toBe(2);
  let resolveApply!: (state: Awaited<ReturnType<typeof test.apply>>) => void;
  test.apply.mockImplementationOnce(()=>new Promise(resolve=>{ resolveApply=resolve; }));
  await page.getByRole('button',{name:'Apply to current session',exact:true}).click();
  [...test.host.querySelectorAll<HTMLButtonElement>('button')].filter(button=>button.textContent?.includes('Apply to current session')).at(-1)!.click();
  await expect.poll(()=>test.apply.mock.calls.length).toBe(1);
  test.setSessionId('second');await expect.poll(()=>test.read.mock.calls.length).toBe(2);
  resolveApply({configured:{max_lines:0,max_bytes:0},effective:{max_lines:0,max_bytes:0},defaults:{max_lines:0,max_bytes:0}});
  await expect.poll(()=>(test.host.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
  expect(test.host.querySelector('[data-terminal-history-effective]')?.textContent).toContain('1000');
  expect(test.host.textContent).not.toContain('Limits applied to this session.');
  expect(test.apply).toHaveBeenCalledWith('first',{max_lines:1000,max_bytes:1048576});
 });
 it('requires a post-settlement read when a defaults response is lost across a session switch',async()=>{
  const test=mount();await expect.poll(()=>test.host.querySelectorAll('input').length).toBe(2);
  let rejectSave!: (error: Error) => void;
  http.request.mockImplementationOnce(()=>new Promise((_resolve,reject)=>{ rejectSave=reject; }));
  await page.getByRole('button',{name:'Save for new sessions'}).click();
  test.setSessionId('second');await expect.poll(()=>test.read.mock.calls.length).toBe(2);
  rejectSave(new Error('response lost'));
  await expect.poll(()=>test.host.textContent).toContain('could not be confirmed');
  expect((test.host.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  expect(http.request.mock.calls.filter(call=>call[1].method==='PUT')).toHaveLength(1);
  await page.getByRole('button',{name:'Reload settings'}).click();
  await expect.poll(()=>(test.host.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
 });
 it('refreshes defaults after a successful save that settles across a session switch',async()=>{
  const test=mount();await expect.poll(()=>test.host.querySelectorAll('input').length).toBe(2);
  let resolveSave!: (limits: {max_lines:number;max_bytes:number}) => void;
  http.request.mockImplementationOnce(()=>new Promise(resolve=>{ resolveSave=resolve; }));
  await page.getByRole('button',{name:'Save for new sessions'}).click();
  test.setSessionId('second');await expect.poll(()=>test.read.mock.calls.length).toBe(2);
  const saved={max_lines:600,max_bytes:4194304};
  http.request.mockResolvedValueOnce({supported:true,can_manage:true,defaults:saved});
  resolveSave(saved);
  await expect.poll(()=>test.host.querySelector('input')?.value).toBe('600');
  await expect.poll(()=>(test.host.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
  expect(http.request.mock.calls.filter(call=>call[1].method==='PUT')).toHaveLength(1);
 });
 it('discards an earlier read that arrives after an uncertain mutation outcome',async()=>{
  const test=mount();await expect.poll(()=>test.host.querySelectorAll('input').length).toBe(2);
  let rejectSave!: (error: Error) => void;
  let resolveRead!: (value: unknown) => void;
  http.request.mockImplementationOnce(()=>new Promise((_resolve,reject)=>{ rejectSave=reject; }));
  await page.getByRole('button',{name:'Save for new sessions'}).click();
  http.request.mockImplementationOnce(()=>new Promise(resolve=>{ resolveRead=resolve; }));
  test.setSessionId('second');await expect.poll(()=>test.read.mock.calls.length).toBe(2);
  rejectSave(new Error('response lost'));
  await expect.poll(()=>test.host.textContent).toContain('could not be confirmed');
  resolveRead({supported:true,can_manage:true,defaults:{max_lines:1000,max_bytes:1048576}});
  await new Promise(requestAnimationFrame);
  expect(test.host.textContent).toContain('could not be confirmed');
  expect(test.host.querySelectorAll('input')).toHaveLength(0);
  await page.getByRole('button',{name:'Reload settings'}).click();
  await expect.poll(()=>test.host.querySelectorAll('input').length).toBe(2);
  expect(http.request.mock.calls.filter(call=>call[1].method==='PUT')).toHaveLength(1);
 });
 it('reports unavailable reads without enabling mutations',async()=>{
  const test=mount();await expect.poll(()=>test.host.querySelectorAll('input').length).toBe(2);
  http.request.mockResolvedValueOnce({supported:false});test.setSessionId('unsupported');
  await expect.poll(()=>test.host.querySelectorAll('input').length).toBe(0);
  expect(test.apply).not.toHaveBeenCalled();
  expect(test.host.textContent).toContain('This Runtime does not support history retention settings.');
 });

});
