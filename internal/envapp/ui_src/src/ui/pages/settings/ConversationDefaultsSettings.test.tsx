// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConversationDefaultsSettings } from './ConversationDefaultsSettings';
import type { FlowerSurfaceAdapter } from '../../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../../../flower_ui/src/copy';
import { settingsSnapshot } from '../../FlowerSurface.navigation.testHarness';
const state = vi.hoisted(() => ({ directory: undefined as any, reasoning: undefined as any }));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@floegence/floe-webapp-core/ui', () => ({
 Button: (props: any) => <button disabled={props.disabled} onClick={props.onClick}>{props.children}</button>,
 Select: (props: any) => <select aria-label={props.ariaLabel ?? props['aria-label']} value={props.value} onChange={event => props.onChange(event.currentTarget.value)}>{props.options.map((value: any) => <option value={value.value} disabled={value.disabled}>{value.label}</option>)}</select>,
}));
vi.mock('../../../../../../flower_ui/src/ReasoningControl', () => ({ FlowerReasoningControl: (props: any) => { state.reasoning = props; return <div />; } }));
vi.mock('../../../../../../flower_ui/src/filePicker/FlowerWorkingDirPickerDialog', () => ({ FlowerWorkingDirPickerDialog: (props: any) => { state.directory = props; return <div />; } }));
let dispose: (() => void) | undefined;
beforeEach(() => vi.clearAllMocks()); afterEach(() => { dispose?.(); document.body.replaceChildren(); });
const preferences = { model_id: 'p/a', working_dir: '/work', reasoning_by_model: {}, revision: 1 };
function mount(failLoad = false) {
 const snapshot = { ...settingsSnapshot(), conversation_preferences: preferences, model_directory: { current_model_id: 'p/a', sources: [], models: [{id:'p/a',label:'Model A', state:'ready'}, {id:'p/b',label:'Model B',state:'ready'}] } };
 const adapter = { loadSettings: vi.fn(async () => snapshot), saveConversationPreferences: vi.fn(async (patch: any) => ({ ...preferences, ...patch, revision:2 })), canMutate:true, getWorkingDirectoryPathContext:vi.fn(), listWorkingDirectoryEntries:vi.fn() } as unknown as FlowerSurfaceAdapter;
 if (failLoad) vi.mocked(adapter.loadSettings).mockRejectedValueOnce(new Error('load offline'));
 const host = document.createElement('div'); document.body.append(host);
 const [allowed, setAllowed] = createSignal(true), [scope, setScope] = createSignal('env:a'); const changed = vi.fn();
 dispose = render(() => <ConversationDefaultsSettings adapter={adapter} copy={DEFAULT_FLOWER_SURFACE_COPY} canEdit={allowed()} active revision={0} generation={0} scope={scope()} onChanged={changed} />, host);
 return {adapter,host,setAllowed,setScope,changed};
}
async function loaded() { await vi.waitFor(() => expect(document.querySelector('select')).not.toBeNull()); }
it('opens with reads only and patches only the selected personal model', async () => {
 const fixture=mount(); await loaded(); expect(fixture.adapter.saveConversationPreferences).not.toHaveBeenCalled();
 const select=document.querySelector('select')!; select.value='p/b'; select.dispatchEvent(new Event('change',{bubbles:true}));
 await vi.waitFor(() => expect(fixture.adapter.saveConversationPreferences).toHaveBeenCalledExactlyOnceWith({model_id:'p/b'}));
 await vi.waitFor(() => expect(fixture.changed).toHaveBeenCalledOnce()); expect(fixture.host.textContent).toContain('/work');
});
it('captures the selected model when saving reasoning and does not alter model memory', async () => {
 const fixture=mount(); await loaded(); state.reasoning.onChange({level:'high'});
 await vi.waitFor(() => expect(fixture.adapter.saveConversationPreferences).toHaveBeenCalledExactlyOnceWith({reasoning:{model_id:'p/a',selection:{level:'high'}}}));
});
it('uses the existing directory picker and patches its exact selected directory', async () => {
 const fixture=mount(); await loaded(); state.directory.onSelect('/work/project');
 await vi.waitFor(() => expect(fixture.adapter.saveConversationPreferences).toHaveBeenCalledExactlyOnceWith({working_dir:'/work/project'}));
});
it('rejects stale callbacks after permission loss', async () => {
 const fixture=mount(); await loaded(); fixture.setAllowed(false); state.directory.onSelect('/forbidden'); state.reasoning.onChange({level:'high'});
 await Promise.resolve(); expect(fixture.adapter.saveConversationPreferences).not.toHaveBeenCalled();
});
it('does not publish a late save into another scope', async () => {
 const fixture=mount(); await loaded(); let finish!: (value: typeof preferences) => void;
 vi.mocked(fixture.adapter.saveConversationPreferences!).mockImplementationOnce(() => new Promise(resolve => {finish=resolve;}));
 state.directory.onSelect('/old-scope'); fixture.setScope('env:b'); finish({...preferences,working_dir:'/old-scope'}); await Promise.resolve(); await Promise.resolve();
 expect(fixture.changed).not.toHaveBeenCalled(); expect(fixture.host.textContent).not.toContain('/old-scope');
});
it('keeps a failed write explicit and never retries it automatically', async () => {
 const fixture=mount(); await loaded(); vi.mocked(fixture.adapter.saveConversationPreferences!).mockRejectedValueOnce(new Error('revision conflict'));
 state.directory.onSelect('/draft'); await vi.waitFor(() => expect(fixture.host.textContent).toContain('revision conflict'));
 expect(fixture.adapter.saveConversationPreferences).toHaveBeenCalledOnce(); expect(fixture.changed).not.toHaveBeenCalled();
});
it('contains a failed initial read and recovers through Refresh', async () => {
 const fixture=mount(true); await vi.waitFor(() => expect(fixture.host.textContent).toContain('load offline'));
 const retry=[...fixture.host.querySelectorAll('button')].find(button => button.textContent==='common.actions.refresh')!; retry.click(); await loaded();
 expect(fixture.adapter.loadSettings).toHaveBeenCalledTimes(2); expect(fixture.adapter.saveConversationPreferences).not.toHaveBeenCalled();
});
