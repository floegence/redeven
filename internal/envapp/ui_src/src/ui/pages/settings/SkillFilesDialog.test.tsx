// @vitest-environment jsdom
import { FlowerExtensionsContext, extensionI18n } from '../../../../../../flower_ui/src/extensions/context';
import { flowerExtensionsAdapter } from '../../../../../../flower_ui/host/extensionsAdapter';
import { Show, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SkillCatalogEntry } from '../../../../../../flower_ui/src/extensions/types';

const api = vi.hoisted(() => vi.fn());
vi.mock('@floegence/floe-webapp-core/ui', async (importOriginal) => ({ ...await importOriginal<typeof import('@floegence/floe-webapp-core/ui')>(), Dialog: (props: any) => <Show when={props.open}><div role="dialog">{props.children}{props.footer}</div></Show> }));
import { SkillFilesDialog } from '../../../../../../flower_ui/src/extensions/SkillFilesDialog';

let dispose: (() => void) | undefined;
const skill = (name: string): SkillCatalogEntry => ({ id: name, name, description: '', path: `/skills/${name}`, scope: 'user', enabled: true, effective: true });
function mount() {
  const host = document.createElement('div'); document.body.append(host);
  const [entry, setEntry] = createSignal<SkillCatalogEntry | null>(skill('first'));
  dispose = render(() => <FlowerExtensionsContext.Provider value={{ ...flowerExtensionsAdapter((method, path, body) => api(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { canInteract: () => true, canAdmin: () => true }), i18n: extensionI18n() }}><SkillFilesDialog entry={entry()} canInteract onClose={() => setEntry(null)} /></FlowerExtensionsContext.Provider>, host);
  return { host, setEntry };
}
function button(host: HTMLElement, label: string) {
  const found = [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
  expect(found).toBeTruthy(); return found!;
}
beforeEach(() => api.mockReset());
afterEach(() => { dispose?.(); document.body.innerHTML = ''; });

it('retries the failed directory request and previews a file without enabling parent navigation at the root', async () => {
  api.mockRejectedValueOnce(new Error('Directory unavailable')).mockResolvedValueOnce({ root: '/skills/first', dir: '.', entries: [{ name: 'SKILL.md', path: 'SKILL.md', is_dir: false }] }).mockResolvedValueOnce({ file: 'SKILL.md', encoding: 'utf8', truncated: false, content: '# Read-only preview' });
  const { host } = mount();
  await vi.waitFor(() => expect(host.textContent).toContain('Directory unavailable'));
  button(host, 'Retry').click();
  await vi.waitFor(() => expect(host.textContent).toContain('SKILL.md'));
  expect(button(host, 'Parent folder').disabled).toBe(true);
  button(host, 'SKILL.md').click();
  await vi.waitFor(() => expect(host.querySelector('pre')?.textContent).toBe('# Read-only preview'));
  expect(api).toHaveBeenLastCalledWith('/_redeven_proxy/api/ai/skills/browse/file?skill_path=%2Fskills%2Ffirst&file=SKILL.md', { method: 'GET' });
});

it('ignores a late response from a previously selected skill', async () => {
  let resolveFirst!: (value: unknown) => void;
  api.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; })).mockResolvedValueOnce({ root: '/skills/second', dir: '.', entries: [{ name: 'second.md', path: 'second.md', is_dir: false }] });
  const { host, setEntry } = mount();
  setEntry(skill('second'));
  await vi.waitFor(() => expect(host.textContent).toContain('second.md'));
  resolveFirst({ root: '/skills/first', dir: '.', entries: [{ name: 'stale.md', path: 'stale.md', is_dir: false }] });
  await Promise.resolve();
  expect(host.textContent).toContain('second.md');
  expect(host.textContent).not.toContain('stale.md');
});
