// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BrowserDisplaySettings } from './BrowserDisplaySettings';
import { WorkbenchAppearanceSettings } from './WorkbenchAppearanceSettings';
import { envComputerViewerFrameRate } from '../../services/computerViewerPreferences';
import { readWorkbenchLocalPreferences, writeWorkbenchLocalPreferences, writeWorkbenchTheme } from '../../services/workbenchLocalPreferences';

const state = vi.hoisted(() => ({ envID: (): string => 'env-first' }));
vi.mock('../EnvContext', () => ({ useEnvContext: () => ({ env_id: () => state.envID() }) }));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Select: (props: any) => <select aria-label={props.ariaLabel} value={props.value} onChange={event => props.onChange(event.currentTarget.value)}>{props.options.map((option: { value: string; label: string }) => <option value={option.value}>{option.label}</option>)}</select>,
}));
let host: HTMLDivElement, dispose: (() => void) | undefined;
beforeEach(() => { localStorage.clear(); state.envID = () => 'env-first'; host = document.createElement('div'); document.body.append(host); });
afterEach(() => { dispose?.(); host.remove(); localStorage.clear(); });
function select(value: string) { const element = host.querySelector('select')!; element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); }
const key = 'workbench:local_preferences:env-first';

it('shows the existing viewer cadence and synchronizes settings with contextual changes without a live viewer', () => {
  envComputerViewerFrameRate.write(15);
  dispose = render(() => <BrowserDisplaySettings />, host);
  expect(host.querySelector('select')!.value).toBe('15'); expect(host.querySelectorAll('option')).toHaveLength(5);
  select('30'); expect(envComputerViewerFrameRate.read()).toBe(30);
  envComputerViewerFrameRate.write(5); expect(host.querySelector('select')!.value).toBe('5');
});
it('edits the Workbench theme before canvas mount using all published choices and preserves lock/mode/tool', () => {
  writeWorkbenchLocalPreferences(key, { version: 5, locked: true, theme: 'mica', mode: 'background', activeTool: 'select' });
  const before = readWorkbenchLocalPreferences(key);
  dispose = render(() => <WorkbenchAppearanceSettings />, host);
  expect(host.querySelector('select')!.value).toBe('mica'); expect(host.querySelectorAll('option')).toHaveLength(6);
  select('aurora'); expect(readWorkbenchLocalPreferences(key)).toEqual({ ...before, theme: 'aurora' });
  writeWorkbenchTheme(key, 'midnight'); expect(host.querySelector('select')!.value).toBe('midnight');
});
it('switches exact environment bindings and detaches the old preference observer', () => {
  const secondKey = 'workbench:local_preferences:env-second';
  writeWorkbenchTheme(key, 'mica'); writeWorkbenchTheme(secondKey, 'terminal');
  let changeEnv!: (value: string) => void;
  dispose = render(() => { const [envID, setEnvID] = createSignal('env-first'); state.envID = envID; changeEnv = setEnvID; return <WorkbenchAppearanceSettings />; }, host);
  changeEnv('env-second'); expect(host.querySelector('select')!.value).toBe('terminal');
  writeWorkbenchTheme(key, 'aurora'); expect(host.querySelector('select')!.value).toBe('terminal');
  select('vibrancy'); expect(readWorkbenchLocalPreferences(secondKey).theme).toBe('vibrancy'); expect(readWorkbenchLocalPreferences(key).theme).toBe('aurora');
});
it('uses the desktop preference binding without creating browser-local duplicates', () => {
  const values = new Map<string, string>();
  window.redevenDesktopStateStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); }, keys: () => [...values.keys()] };
  try {
    dispose = render(() => <WorkbenchAppearanceSettings />, host); select('midnight');
    expect(JSON.parse(values.get('workbench:local_preferences:desktop')!).theme).toBe('midnight'); expect(Object.keys(localStorage)).toHaveLength(0);
  } finally { dispose?.(); dispose = undefined; delete window.redevenDesktopStateStorage; }
});
