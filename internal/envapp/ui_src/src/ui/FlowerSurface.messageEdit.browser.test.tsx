import '../index.css';
import './flower-feature.css';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { page } from 'vitest/browser';
import type { FlowerMessageEditDraft, FlowerMessageEditInput, FlowerSurfaceAdapter, FlowerThreadView } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { flowerTurnAdmissionError } from '../../../../flower_ui/src/flowerTurnAdmission';
import { adapter, thread, liveBootstrap, renderSurfaceWithAdapter, waitFor } from './FlowerSurface.media.test-support';
import { withModelDirectoryFixture } from '../../../../flower_ui/testing/modelDirectoryFixture';

beforeEach(async () => {
 await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase('redeven-flower-transport'); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
});
const initial = thread({ thread_id: 'edit-message', model_id: 'openai/gpt-5.2', status: 'idle', working_dir: '/workspace' });
const draft: FlowerMessageEditDraft = { storage_generation: 'generation', item_id: 'user:old', turn_id: 'old', input_fingerprint: 'a'.repeat(64), prompt: 'Original input', references: [{ kind: 'reference_snapshot', reference_snapshot: { kind: 'text', label: 'Captured context', text: 'Full captured body' } }], reference_ids: ['ref-old'], attachments: [] };
function view(active = false): FlowerThreadView {
 const result = liveBootstrap(initial, 2);
 const current: FlowerThreadView['current'] = { ...result.current!, activity: active ? 'active' : 'idle', turn_id: 'old', run_id: 'old-run', ...(active ? { run_progress: { phase: 'waiting_response' as const } } : {}),
  items: [{ id: 'user:old', turn_id: 'old', run_id: 'old-run', ordinal: 1, kind: 'user', text: 'Original input', created_at: '2026-11-09T00:00:00Z' }], queue: [] };
 return { thread: applyFlowerRuntimeCurrentView(result.thread, current), current };
}
async function mount(extra: Partial<FlowerSurfaceAdapter> = {}, active = false) {
 await page.viewport(900, 800);
 const stop = vi.fn(async () => undefined);
 const surface = renderSurfaceWithAdapter({ ...adapter(true), loadSettings: async () => withModelDirectoryFixture(await adapter(true).loadSettings()), listThreads: async () => [initial], loadThread: async () => view(active), prepareMessageEdit: vi.fn(async () => draft), editLastMessage: vi.fn(async () => {}), stopThread: stop, ...extra });
 await waitFor(() => !!surface.querySelector('[data-thread-id="edit-message"] button'));
 (surface.querySelector('[data-thread-id="edit-message"] button') as HTMLButtonElement).click();
 await waitFor(() => !!surface.querySelector('[data-flower-message-edit="user:old"]'));
 return { surface, stop };
}
function setText(surface: HTMLElement, value: string) {
 const textarea = surface.querySelector('.flower-composer textarea') as HTMLTextAreaElement;
 textarea.focus(); textarea.value = value; textarea.setSelectionRange(value.length, value.length); textarea.dispatchEvent(new InputEvent('input', { bubbles: true })); return textarea;
}
async function open(surface: HTMLElement) {
 surface.querySelector<HTMLButtonElement>('[data-flower-message-edit="user:old"]')!.click();
 await waitFor(() => !!surface.querySelector('[data-flower-message-editing]'));
 await waitFor(() => surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')?.value === draft.prompt);
}
function send(surface: HTMLElement) { surface.querySelector<HTMLButtonElement>('[data-flower-primary-action="send"]')!.click(); }

describe('Flower latest message editing', () => {
 it('opens without stopping, preserves the ordinary draft and cancels with Escape', async () => {
  const { surface, stop } = await mount({}, true);
  setText(surface, 'Unsent next message'); await open(surface);
  expect(stop).not.toHaveBeenCalled();
  expect(surface.querySelector('[data-flower-message-editing]')!.querySelector('h1,h2,h3,.flower-message-edit-notice')).toBeNull();
  expect(surface.textContent).toContain('Captured context');
  const field = setText(surface, 'Changed draft');
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await waitFor(() => !surface.querySelector('[data-flower-message-editing]'));
  expect(surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!.value).toBe('Unsent next message');
  expect(stop).not.toHaveBeenCalled();
 });
 it('sends a frozen complete input, handles active turns, and restores the ordinary draft', async () => {
  const edit = vi.fn(async (_thread: string, _input: FlowerMessageEditInput) => {});
  const { surface, stop } = await mount({ editLastMessage: edit }, true);
  setText(surface, 'Keep my draft'); await open(surface); setText(surface, '/goal literal replacement'); send(surface);
  await waitFor(() => edit.mock.calls.length === 1);
  const [threadID, input] = edit.mock.calls[0]!;
  expect(threadID).toBe('edit-message'); expect(input).toMatchObject({ storage_generation: 'generation', item_id: 'user:old', prompt: '/goal literal replacement', stop_active: true, retained_reference_ids: ['ref-old'] });
  expect(stop).not.toHaveBeenCalled();
  await waitFor(() => !surface.querySelector('[data-flower-message-editing]'));
  expect(surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!.value).toBe('Keep my draft');
 });
 it('freezes unknown submission and retries exactly the same request', async () => {
  const edit = vi.fn(async (_thread: string, _input: FlowerMessageEditInput) => {}).mockRejectedValueOnce(flowerTurnAdmissionError('unknown', new Error('lost response')));
  const { surface } = await mount({ editLastMessage: edit }); await open(surface); setText(surface, 'Replacement'); send(surface);
  await waitFor(() => surface.textContent!.includes('Submission could not be confirmed'));
  expect(surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!.readOnly).toBe(true);
  expect(surface.querySelector<HTMLButtonElement>('.flower-composer-reference-chip-remove')!.disabled).toBe(true);
  const field=surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;field.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  expect(surface.querySelector('[data-flower-message-editing]')).not.toBeNull();
  send(surface); await waitFor(() => edit.mock.calls.length === 2);
  expect(edit.mock.calls[1]).toEqual(edit.mock.calls[0]);
  await waitFor(() => !surface.querySelector('[data-flower-message-editing]'));
 });
 it('keeps IME Enter local and lets touch users view and reuse the previous version without running it', async () => {
  const edit = vi.fn(async () => {});
  const previous = { ...draft, prompt: 'Earlier input' };
  const { surface } = await mount({ prepareMessageEdit: async () => ({ ...draft, revision_request_key: 'edit-message:previous' }), editLastMessage: edit,
   loadMessageEditHistory: async () => ({ draft: previous, items: [{ id: 'earlier', turn_id: 'old', ordinal: 1, kind: 'user', text: 'Earlier input' }, { id: 'answer', turn_id: 'old', ordinal: 2, kind: 'assistant', text: 'Earlier reply' }] }) });
  await page.viewport(390, 844);
  surface.querySelector<HTMLButtonElement>('[aria-label="Previous version"]')!.click();
  await waitFor(() => !!document.querySelector('.flower-message-version-dialog'));
  expect(document.querySelector('.flower-message-version-dialog')!.textContent).toContain('Earlier reply');
  [...document.querySelectorAll<HTMLButtonElement>('.flower-message-version-dialog button')].find(button => button.textContent === 'Use this version')!.click();
  await waitFor(() => surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')?.value === 'Earlier input');
  expect(edit).not.toHaveBeenCalled();
  const field = setText(surface, '输入'); field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })); expect(edit).not.toHaveBeenCalled();
  await page.screenshot({ element: surface, path: '__screenshots__/flower-message-edit-mobile.png' });
 });
 it('uses Enter to replace a waiting turn without answering its pending question',async()=>{
  const base=view(true);const current:FlowerThreadView['current']={...base.current!,interactions:[{id:'question',turn_id:'old',run_id:'old-run',kind:'input',input:{summary:'Choose',questions:[{id:'choice',prompt:'Choose',kind:'select_or_write',options:['One','Two']}]}}]};const waiting:FlowerThreadView={current,thread:applyFlowerRuntimeCurrentView(base.thread,current)};
  const edit=vi.fn(async()=>{}),answer=vi.fn(async()=>{throw new Error('edit must not answer a question');});
  const {surface}=await mount({loadThread:async()=>waiting,editLastMessage:edit,submitInput:answer});
  await open(surface);const field=setText(surface,'Revised request');field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  await waitFor(()=>edit.mock.calls.length===1);expect(answer).not.toHaveBeenCalled();
 });
 it('retains admitted attachments and lets users remove context before sending',async()=>{
  const edit=vi.fn(async(_thread:string,_input:FlowerMessageEditInput)=>{});
  const {surface}=await mount({prepareMessageEdit:async()=>({...draft,attachments:[{attachment_id:'image',thread_id:'edit-message',turn_id:'old',name:'diagram.png',mime_type:'image/png',size_bytes:4}]}),editLastMessage:edit});
  await open(surface);expect(surface.textContent).toContain('diagram.png');
  surface.querySelector<HTMLButtonElement>('.flower-composer-reference-chip-remove')!.click();
  await waitFor(()=>!surface.querySelector('.flower-composer-reference-chip-remove'));setText(surface,'Keep image');send(surface);
  await waitFor(()=>edit.mock.calls.length===1);expect(edit.mock.calls[0]![1]).toMatchObject({retained_attachment_ids:['image'],retained_reference_ids:[]});
 });
 it('keeps a delayed edit response scoped to its original thread',async()=>{
  let finish!:()=>void;const pending=new Promise<void>(resolve=>{finish=resolve;});
  const other=thread({thread_id:'other',title:'Other conversation',model_id:'openai/gpt-5.2'});
  const {surface}=await mount({listThreads:async()=>[initial,other],loadThread:async id=>id==='other'?liveBootstrap(other,2):view(),editLastMessage:async()=>pending});
  await open(surface);setText(surface,'Replacement');send(surface);
  surface.querySelector<HTMLButtonElement>('[data-thread-id="other"] .flower-thread-card-select-button')!.click();
  await waitFor(()=>surface.querySelector('[data-thread-id="other"]')?.getAttribute('data-flower-thread-active')==='true');
  await waitFor(()=>!surface.querySelector('[data-flower-message-editing]') && surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')?.disabled === false);
  const otherField=setText(surface,'Other draft');
  expect(otherField.value).toBe('Other draft');finish();
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  await waitFor(()=>!surface.querySelector('[data-flower-message-editing]'));
  expect(surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!.value).toBe('Other draft');
 });

 it('stages newly added attachments against the thread while preserving the edit identity',async()=>{
  const capability={model_id:'openai/gpt-5.2',revision:'edit-capability',enabled:true,supports_long_text:true,max_attachments:10,max_file_size_bytes:1000000,max_total_size_bytes:2000000,routes:{'text/plain':'tool_read' as const}};
  const scope=vi.fn(async(targetID?:string)=>({staging_scope_id:'edit-scope',target_id:targetID ?? '',capability:'secret',expires_at_unix_ms:Date.now()+60000}));
  const upload=vi.fn(async()=>({attachment_id:'added',name:'notes.txt',mime_type:'text/plain',size_bytes:4,digest_sha256:'b'.repeat(64),locator:'staged',source:'file' as const,capability_revision:capability.revision}));
  const edit=vi.fn(async(_thread:string,_input:FlowerMessageEditInput)=>{});
  const {surface}=await mount({loadAttachmentCapability:async()=>capability,createAttachmentStagingScope:scope,uploadAttachment:upload,editLastMessage:edit});
  await open(surface);
  const picker=surface.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(picker,'files',{configurable:true,value:[new File(['test'],'notes.txt',{type:'text/plain'})]});picker.dispatchEvent(new Event('change',{bubbles:true}));
  await waitFor(()=>!!surface.querySelector('[data-attachment-status="staged_ready"]'));send(surface);
  await waitFor(()=>edit.mock.calls.length===1);
  expect(scope).toHaveBeenCalledWith('edit-message');expect(upload).toHaveBeenCalledOnce();
  expect(edit.mock.calls[0]![1]).toMatchObject({item_id:'user:old',attachment_ids:['added'],retained_reference_ids:['ref-old'],staging_scope:{staging_scope_id:'edit-scope',target_id:'edit-message'}});
 });

});
