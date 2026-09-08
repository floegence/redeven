import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { CreateCodespaceDialog } from './CreateCodespaceDialog';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../../flower_ui/src/copy';
import type { PickerPanelProps } from '@floegence/floe-webapp-core/ui';

vi.mock('../i18n', () => ({ useI18n: () => ({ t: (key: string, args?: { path?: string }) => args?.path ?? key }) }));
vi.mock('../primitives/EnvAppModal', () => ({ Dialog: (props: any) => <Show when={props.open}><section role="dialog">{props.children}{props.footer}</section></Show> }));
const home = '/Users/alice';
const external = '/Volumes/team/project';
const pathContext = { homePathAbs: home, defaultRootId: 'home', roots: [
  { id: 'home', label: 'Home', pathAbs: home, permissions: { read: true, write: true } },
  { id: 'computer', label: 'Root', pathAbs: '/', permissions: { read: true, write: false } },
] };
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach((fn) => fn()); document.body.innerHTML = ''; });
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function input(element: HTMLInputElement, value: string) { element.value = value; element.dispatchEvent(new InputEvent('input', { bubbles: true })); }
function setup(overrides: PickerPanelProps = {}) {
  const [open, setOpen] = createSignal(true);
  const [scopeKey, setScopeKey] = createSignal('a');
  const onCreate = vi.fn();
  const loadDirectory = vi.fn().mockResolvedValue([]);
  const loadPathContext = vi.fn().mockResolvedValue(pathContext);
  const host = document.createElement('div'); document.body.appendChild(host);
  cleanup.push(render(() => <CreateCodespaceDialog open={open()} loading={false} onOpenChange={setOpen} onCreate={onCreate}
    pickerProps={{ copy: DEFAULT_FLOWER_SURFACE_COPY.filesystemPicker, loadDirectory, loadPathContext, ...overrides, get scopeKey() { return scopeKey(); } }} />, host));
  const button = (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === label)!;
  const path = () => host.querySelector<HTMLInputElement>('input[aria-label="Directory path"]')!;
  const field = (name: string) => host.querySelector<HTMLInputElement>(`input[placeholder="codespaces.dialog.${name}Placeholder"]`)!;
  const create = () => button('codespaces.actions.create');
  const navigate = async (value: string) => { input(path(), value); button('Go').click(); await flush(); };
  return { host, button, path, field, create, navigate, onCreate, loadDirectory, loadPathContext, setOpen, setScopeKey };
}

describe('Space directory form with the published inline picker', () => {
  it('creates an outside-Home directory unchanged and preserves edited metadata across navigation', async () => {
    const f = setup(); await flush();
    await f.navigate(external);
    expect(f.field('name').value).toBe('project');
    input(f.field('name'), 'My workspace'); input(f.field('description'), 'User description');
    await f.navigate('/');
    expect(f.field('name').value).toBe('My workspace');
    expect(f.field('description').value).toBe('User description');
    await f.navigate(external);
    f.create().click();
    expect(f.onCreate).toHaveBeenCalledExactlyOnceWith(external, 'My workspace', 'User description');
    expect(f.loadDirectory.mock.calls.map(([path]) => path)).toEqual([home, external, '/', external]);
    expect(f.host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });
  it('uses the runtime default root and root label without requiring ancestor listing', async () => {
    const loadDirectory = vi.fn().mockResolvedValue([]);
    const f = setup({ loadPathContext: async () => ({ ...pathContext, defaultRootId: 'project', roots: [{ id: 'project', label: 'Project', pathAbs: external }] }), loadDirectory });
    await flush();
    expect(loadDirectory).toHaveBeenCalledExactlyOnceWith(external, { showHidden: false });
    expect(f.field('name').value).toBe('project');
    await f.navigate('/');
    expect(f.field('name').value).toBe('Root');
  });
  it('blocks unvalidated input, retains errors and metadata, and retries in place', async () => {
    const f = setup(); await flush();
    input(f.field('name'), 'Keep me');
    input(f.path(), external); await flush();
    expect(f.create().disabled).toBe(true);
    f.loadDirectory.mockRejectedValueOnce(new Error('Access denied'));
    f.button('Go').click(); await flush();
    expect(f.host.querySelector('[role="alert"]')?.textContent).toContain('Access denied');
    expect(f.path().value).toBe(external);
    expect(f.create().disabled).toBe(true);
    f.button('Retry').click(); await flush();
    f.create().click();
    expect(f.onCreate).toHaveBeenCalledWith(external, 'Keep me', external);
    // A failed create leaves the parent open and retains the entire form.
    expect(f.field('name').value).toBe('Keep me');
    expect(f.path().value).toBe(external);
  });
  it('discards earlier navigation, close, and environment responses', async () => {
    const f = setup(); await flush();
    let resolveOld!: (entries: []) => void;
    f.loadDirectory.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    f.button('Root').click(); await flush();
    await f.navigate(external); resolveOld([]); await flush();
    f.create().click(); expect(f.onCreate).toHaveBeenLastCalledWith(external, 'project', external);
    f.loadDirectory.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    f.button('Root').click(); await flush();
    f.setOpen(false); await flush(); f.setOpen(true); await flush();
    resolveOld([]); await flush();
    expect(f.path().value).toBe(home); expect(f.field('name').value).toBe('alice');
    f.loadDirectory.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    f.button('Root').click(); await flush();
    f.setScopeKey('b'); await flush(); resolveOld([]); await flush();
    expect(f.path().value).toBe(home);
    expect(f.loadPathContext).toHaveBeenCalledTimes(3);
  });
  it('shows context failures without inventing roots or an authorized selection', async () => {
    const f = setup({ loadPathContext: async () => { throw new Error('Connection failed'); } }); await flush();
    expect(f.host.querySelector('[role="alert"]')?.textContent).toContain('Connection failed');
    expect(f.button('Root')).toBeUndefined(); expect(f.create().disabled).toBe(true);
    expect(f.loadDirectory).not.toHaveBeenCalled();
  });
});
