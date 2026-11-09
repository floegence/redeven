// @vitest-environment jsdom
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserEditorSetupSession } from './browserEditorSetupSession';
import type { BrowserEditorSetupOrchestrationOptions, BrowserEditorSetupResult } from './browserEditorSetup';
const api = vi.hoisted(() => ({create:vi.fn(), cancel:vi.fn(), run:vi.fn()}));
vi.mock('./browserEditorSetup', () => ({
  createBrowserEditorSetupOrchestration: api.create, defaultBrowserEditorInstallMethod: () => 'desktop_transfer',
  cancelBrowserEditorSetup: api.cancel, browserEditorRuntimeOperationAbsenceConfirmed: () => true,
}));
const cleanups: (() => void)[] = [];
function session() {
  const [environment, setEnvironment] = createSignal('one');
  const value = createRoot(dispose => {cleanups.push(dispose); return createBrowserEditorSetupSession({env_id:environment});});
  return {value, setEnvironment};
}
afterEach(() => {for (const cleanup of cleanups.splice(0)) cleanup(); vi.resetAllMocks();});
describe('background Browser Editor preparation', () => {
  it('retains Desktop progress without a view and coalesces duplicate starts', async () => {
    const {value} = session(); let finish!: (result: BrowserEditorSetupResult) => void; let options!: BrowserEditorSetupOrchestrationOptions;
    api.run.mockReturnValue(new Promise(resolve => {finish = resolve;}));
    api.create.mockImplementation(input => {options=input; return {run:api.run, retire:vi.fn(), cancel:api.cancel, snapshot:() => ({operation:{installMethod:'desktop_transfer'}})};});
    const pending=value.run(undefined); await value.run(undefined);
    options.onSnapshot!({requestedOperation:{operationID:options.operationID,installMethod:'desktop_transfer'},operation:{operationID:options.operationID,installMethod:'desktop_transfer'},localProgress:{operation_id:options.operationID,phase:'download',state:'running',completed_bytes:10,updated_at_unix_ms:1},operationObserved:false,phase:'desktop_preparation',runtimeStatus:null,result:null});
    expect(value.runtimePrepareSubmitting()).toBe(true); expect(value.runtimePrepareProgress()?.phase).toBe('download');
    finish({state:'cancelled',ok:false,prepared:false,cancelled:true,message:'Canceled by host'}); await pending;
    expect(value.runtimePrepareLocalCancelled()).toBe(true); expect(value.runtimePrepareSubmitting()).toBe(false);
    expect(api.create).toHaveBeenCalledOnce(); expect(api.cancel).not.toHaveBeenCalled();
  });
  it('does not import late work into another environment or cancel it implicitly', async () => {
    const {value,setEnvironment}=session(); let finish!: (result: BrowserEditorSetupResult) => void;
    api.run.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
    api.create.mockReturnValue({run:api.run, retire:vi.fn(), cancel:api.cancel});
    const pending=value.run(undefined); setEnvironment('two');
    finish({state:'cancelled',ok:false,prepared:false,cancelled:true,message:'Canceled by host'}); await pending;
    expect(value.runtimePrepareLocalCancelled()).toBe(false); expect(value.status()).toBeNull(); expect(api.cancel).not.toHaveBeenCalled();
  });
});
