// @vitest-environment jsdom
import { FlowerExtensionsContext, extensionI18n } from '../../../../../../../flower_ui/src/extensions/context';
import { flowerExtensionsAdapter } from '../../../../../../../flower_ui/host/extensionsAdapter';
import { Show, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ api: vi.fn(), canAdmin: true, canInteract: (): boolean => true }));
vi.mock('../../../../../../../flower_ui/src/extensions/SkillsCatalogList', () => ({ SkillsCatalogList: (props: any) => <div>{props.skills.map((entry: any) => <div>{entry.name}<button disabled={!props.canAdmin} onClick={() => props.onDelete(entry)}>Delete</button><button disabled={!props.canAdmin} onClick={() => props.onToggle(entry, false)}>Disable</button></div>)}</div> }));
vi.mock('@floegence/floe-webapp-core/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('@floegence/floe-webapp-core/ui')>(),
  Dialog: (props: any) => <Show when={props.open}><div role="dialog"><h2>{props.title}</h2>{props.children}{props.footer}</div></Show>,
  ConfirmDialog: (props: any) => <Show when={props.open}><div role="dialog"><h2>{props.title}</h2>{props.children}<button disabled={props.loading || props.disabled} onClick={props.onConfirm}>{props.confirmText}</button></div></Show>,
}));
import { SkillsSection } from '../../../../../../../flower_ui/src/extensions/SkillsSection';
let dispose: (() => void) | undefined;
function mount() { const host = document.createElement('div'); document.body.append(host); dispose = render(() => <FlowerExtensionsContext.Provider value={{ ...flowerExtensionsAdapter((method, path, body) => state.api(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { canInteract: () => state.canInteract(), canAdmin: () => state.canAdmin }), i18n: extensionI18n() }}><SkillsSection /></FlowerExtensionsContext.Provider>, host); return host; }
function click(host: HTMLElement, text: string) { const button = [...host.querySelectorAll('button')].find((item) => (item.getAttribute('aria-label') ?? item.textContent?.trim()) === text); expect(button, text).toBeTruthy(); button!.click(); }
const skill = { id: 'one', name: 'example', description: 'Example skill', path: '/skills/example/SKILL.md', scope: 'user', enabled: true, effective: true };
beforeEach(() => { state.canAdmin = true; state.canInteract = () => true; state.api.mockReset().mockImplementation(async (path: string) => path.endsWith('/sources') ? { items: [] } : { skills: [skill], catalog_version: 1 }); });
afterEach(() => { dispose?.(); document.body.innerHTML = ''; });
describe('Skills settings API integration', () => {
  it('loads after entering the page while the runtime is still connecting', async () => {
    const [connected, setConnected] = createSignal(false);
    state.canInteract = connected;
    const host = mount();
    expect(state.api).not.toHaveBeenCalled();
    setConnected(true);
    await vi.waitFor(() => expect(host.textContent).toContain('example'));
  });
  it('loads the catalog on entry and reports failed reloads', async () => {
    const host = mount();
    await vi.waitFor(() => expect(state.api).toHaveBeenCalledWith('/_redeven_proxy/api/ai/skills', { method: 'GET' }));
    await vi.waitFor(() => expect(host.textContent).toContain('example'));
    await vi.waitFor(() => expect([...host.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'Reload')?.disabled).toBe(false));
    state.api.mockRejectedValue(new Error('Catalog is unavailable'));
    click(host, 'Reload');
    await vi.waitFor(() => expect(host.querySelector('[data-floe-status-indicator] button')?.getAttribute('aria-label')).toContain('Catalog is unavailable'));
  });
  it('creates a skill using the confirmed form and keeps the form after failure', async () => {
    const host = mount();
    await vi.waitFor(() => expect([...host.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'Reload')?.disabled).toBe(false));
    click(host, 'Create Skill');
    const fields = host.querySelectorAll('[role="dialog"] input');
    const fill = (field: Element, value: string) => { (field as HTMLInputElement).value = value; field.dispatchEvent(new Event('input', { bubbles: true })); };
    fill(fields[0], 'new-skill'); fill(fields[1], 'A useful skill');
    state.api.mockImplementation(async (path: string, options: { method: string }) => { if (options.method === 'POST') throw new Error('Create rejected'); return path.endsWith('/sources') ? { items: [] } : { skills: [], catalog_version: 1 }; });
    click(host, 'Create');
    await vi.waitFor(() => expect(state.api).toHaveBeenCalledWith('/_redeven_proxy/api/ai/skills', { method: 'POST', body: JSON.stringify({ scope: 'user', name: 'new-skill', description: 'A useful skill', body: '' }) }));
    await vi.waitFor(() => expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Create rejected'));
  });
  it('requires confirmation before deleting a skill', async () => {
    const host = mount(); await vi.waitFor(() => expect(host.textContent).toContain('example'));
    click(host, 'Delete');
    expect(state.api.mock.calls.some(([, options]) => options.method === 'DELETE')).toBe(false);
    click(host.querySelector('[role="dialog"]')!, 'Delete');
    await vi.waitFor(() => expect(state.api).toHaveBeenCalledWith('/_redeven_proxy/api/ai/skills', { method: 'DELETE', body: JSON.stringify({ scope: 'user', name: 'example' }) }));
  });
  it('keeps failed toggles visible and prevents catalog reload during a mutation', async () => {
    const host = mount();
    await vi.waitFor(() => expect(host.textContent).toContain('example'));
    await vi.waitFor(() => expect([...host.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'Reload')?.disabled).toBe(false));
    let rejectToggle!: (error: Error) => void;
    state.api.mockImplementation((_path: string, options: { method: string }) => options.method === 'PUT' ? new Promise((_, reject) => { rejectToggle = reject; }) : Promise.resolve({ skills: [] }));
    click(host, 'Disable');
    expect([...host.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'Reload')?.disabled).toBe(true);
    rejectToggle(new Error('Toggle rejected'));
    await vi.waitFor(() => expect(host.querySelector('[data-floe-status-indicator] button')?.getAttribute('aria-label')).toContain('Toggle rejected'));
    expect(host.textContent).toContain('example');
  });
  it('requires validation of the current install form and retains errors for retry', async () => {
    const host = mount();
    await vi.waitFor(() => expect(host.textContent).toContain('example'));
    click(host, 'Install from GitHub');
    const dialog = host.querySelector('[role="dialog"]')! as HTMLElement;
    const install = [...dialog.querySelectorAll('button')].find((button) => button.textContent === 'Install')!;
    expect(install.disabled).toBe(true);
    const repository = dialog.querySelector('input[placeholder="openai/skills"]')! as HTMLInputElement;
    repository.value = 'example/skills'; repository.dispatchEvent(new Event('input', { bubbles: true }));
    state.api.mockImplementation(async (path: string) => {
      if (path.endsWith('/validate')) return { resolved: [{ name: 'example', target_dir: '/skills/example' }] };
      throw new Error('Import rejected');
    });
    click(dialog, 'Validate');
    await vi.waitFor(() => expect(install.disabled).toBe(false));
    repository.value = 'example/other'; repository.dispatchEvent(new Event('input', { bubbles: true }));
    expect(install.disabled).toBe(true);
    click(dialog, 'Validate');
    await vi.waitFor(() => expect(install.disabled).toBe(false));
    click(dialog, 'Install');
    await vi.waitFor(() => expect(dialog.textContent).toContain('Import rejected'));
    expect(repository.value).toBe('example/other');
    expect(state.api).toHaveBeenLastCalledWith('/_redeven_proxy/api/ai/skills/import/github', expect.objectContaining({ method: 'POST', body: expect.stringContaining('example/other') }));
  });
  it('disables catalog mutations for readers', async () => {
    state.canAdmin = false;
    const host = mount();
    await vi.waitFor(() => expect(host.textContent).toContain('example'));
    for (const title of ['Create Skill', 'Install from GitHub', 'Delete', 'Disable']) {
      const button = [...host.querySelectorAll('button')].find((button) => button.textContent === title)!;
      expect(button.disabled, title).toBe(true);
      button.click();
    }
    expect(state.api.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
  });
});
