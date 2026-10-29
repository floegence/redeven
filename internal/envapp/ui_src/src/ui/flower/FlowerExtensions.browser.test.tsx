import { agentPluginsFixture } from './agentPluginsFixture';
import '../../index.css';
import { FloeProvider, useTheme } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { commands, page, userEvent } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import { FlowerExtensionsSurface } from '../../../../../flower_ui/src/extensions/FlowerExtensionsSurface';
import { extensionI18n } from '../../../../../flower_ui/src/extensions/context';
import type { FlowerExtensionsAdapter, MCPServer, MCPServerInput, SkillCatalogEntry } from '../../../../../flower_ui/src/extensions/types';
import { expectSingleInputFocus } from '../../styles/inputFocus.test-support';

let host: HTMLDivElement;
let dispose: (() => void) | undefined;
let theme: ReturnType<typeof useTheme>;
function ThemeObserver() { theme = useTheme(); return null; }
const suppliedSkillIcon = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#25675f"/><path d="m12 11-5 5 5 5m8-10 5 5-5 5" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>');
const suppliedMCPIcon = (dark: boolean) => 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${dark ? '#c8e5fa' : '#244d79'}"/><path d="m10 10 12 12m0-12L10 22" stroke="${dark ? '#244d79' : '#c8e5fa'}" stroke-width="2"/><g fill="${dark ? '#244d79' : '#c8e5fa'}"><circle cx="9" cy="9" r="3"/><circle cx="23" cy="9" r="3"/><circle cx="9" cy="23" r="3"/><circle cx="23" cy="23" r="3"/></g></svg>`);
const skills: SkillCatalogEntry[] = [
  { id: 'review', name: 'code-review', description: 'Review changes with a focus on correctness, clear architecture, and maintainability.', path: '/Users/alex/.redeven/skills/code-review/SKILL.md', scope: 'user', enabled: true, effective: true },
  { id: 'routing', name: 'environment-routing', description: 'Choose the right environment for remote diagnostics and project work.', path: '/runtime/skills/environment-routing/SKILL.md', scope: 'system', enabled: true, effective: true },
  { id: 'writing', name: 'technical-writing', description: 'Turn complex ideas into concise, useful documentation.', path: '/Users/alex/.agents/skills/technical-writing/SKILL.md', scope: 'user_agents', enabled: false, effective: false },
];
const server: MCPServer = { id: 'workspace', revision: 1, name: 'Workspace tools', transport: 'http', url: 'https://tools.example.com/mcp', header_keys: ['Authorization'], env_keys: [], enabled: true, checked_at: 1780000000000, tools: [{ name: 'find_document', description: 'Find documents in the connected workspace.' }, { name: 'create_task', description: 'Create a task with an owner and due date.' }] };
function fixture(empty = false, count = 0) {
  let servers: readonly MCPServer[] = empty ? [] : [server, { ...server, id: 'local', name: 'Local workspace', transport: 'stdio', url: undefined, command: 'workspace-mcp', args: ['--read-only'], header_keys: [], env_keys: ['API_KEY'], enabled: false }];
  const catalogSkills = count ? Array.from({ length: count }, (_, index) => ({ ...skills[index % skills.length], id: `skill-${index}`, name: `skill-${String(index + 1).padStart(2, '0')}`, path: `/skills/skill-${index}/SKILL.md` })) : skills;
  if (count) servers = Array.from({ length: count }, (_, index) => ({ ...server, id: `server-${index}`, name: `Workspace ${String(index + 1).padStart(2, '0')}` }));
  const [admin, setAdmin] = createSignal(true);
  const saveMCP = vi.fn(async (input: MCPServerInput) => {
    const next: MCPServer = { ...input, id: input.id ?? 'mcp_generated', name: input.name ?? 'Project tools', revision: input.revision + 1, header_keys: Object.keys(input.headers ?? {}), env_keys: Object.keys(input.env ?? {}), checked_at: server.checked_at, tools: server.tools };
    servers = [...servers.filter(item => item.id !== input.id), next]; return { servers };
  });
  const deleteMCP = vi.fn(async ({ id }: { id: string }) => { servers = servers.filter(item => item.id !== id); return { servers }; });
  const adapter: FlowerExtensionsAdapter = {
    plugins: agentPluginsFixture(),
    canInteract: () => true, canAdmin: admin,
    listSkills: vi.fn(async () => ({ skills: empty ? [] : catalogSkills, catalog_version: 1 })),
    listSkillSources: vi.fn(async () => ({ items: [{ skill_path: skills[0].path, source_type: 'github_import', source_id: 'example/skills#code-review' }, { skill_path: skills[1].path, source_type: 'system_bundle', source_id: 'redeven' }] })),
    toggleSkill: vi.fn(async () => ({ skills, catalog_version: 2 })),
    createSkill: vi.fn(async () => ({ skills, catalog_version: 2 })),
    deleteSkill: vi.fn(async () => ({ skills, catalog_version: 2 })),
    reinstallSkill: vi.fn(async () => ({ catalog: { skills, catalog_version: 2 }, reinstalled: [] })),
    validateSkillImport: vi.fn(async () => ({ resolved: [] })),
    importSkills: vi.fn(async () => ({ catalog: { skills, catalog_version: 2 }, imports: [] })),
    browseSkillTree: vi.fn(async () => ({ root: '/skills', dir: '.', entries: [{ name: 'SKILL.md', path: 'SKILL.md', is_dir: false, size: 200, modified_at_unix_ms: 1 }] })),
    browseSkillFile: vi.fn(async () => ({ root: '/skills', file: 'SKILL.md', encoding: 'utf8', truncated: false, size: 15, content: '# Code review' })),
    listMCP: vi.fn(async () => ({ servers })), saveMCP, deleteMCP,
    checkMCP: vi.fn(async () => ({ servers })),
  };
  return { adapter, setAdmin, saveMCP, deleteMCP };
}
async function mount(width = 1280, dark = false, locale = 'en-US', empty = false, count = 0, setup?: (adapter: FlowerExtensionsAdapter) => void) {
  await page.viewport(width, 850);
  localStorage.removeItem('extensions-test-theme');
  const state = fixture(empty, count); host = document.createElement('div'); host.style.height = '830px'; document.body.append(host);
  setup?.(state.adapter);
  dispose = render(() => <FloeProvider config={{ theme: { storageKey: 'extensions-test-theme', defaultTheme: dark ? 'dark' : 'light' } }}><ThemeObserver /><FlowerExtensionsSurface adapter={state.adapter} i18n={extensionI18n(locale)} onBack={vi.fn()} /></FloeProvider>, host);
  theme.setTheme(dark ? 'dark' : 'light');
  await expect.poll(() => document.documentElement.classList.contains('dark')).toBe(dark);
  await expect.poll(() => state.adapter.listSkills).toHaveBeenCalled();
  return state;
}
function noOverflow() {
  expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
  const panel = host.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
  expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
  for (const button of panel.querySelectorAll('button')) {
    if (!button.getClientRects().length) continue;
    expect(getComputedStyle(button).whiteSpace).toBe('nowrap');
    const box = button.getBoundingClientRect();
    expect(box.right).toBeLessThanOrEqual(host.getBoundingClientRect().right + 1);
    expect(box.left).toBeGreaterThanOrEqual(host.getBoundingClientRect().left - 1);
  }
}
afterEach(() => { dispose?.(); host?.remove(); document.documentElement.classList.remove('dark'); });

it('separates primary tabs from the page title and keeps plugin empty state concise', async () => {
  await mount(1280, false, 'zh-CN');
  const header = host.querySelector<HTMLElement>('.flower-extensions-header')!;
  const navigation = host.querySelector<HTMLElement>('.flower-extensions-tabs')!;
  expect(navigation.getBoundingClientRect().top).toBeGreaterThanOrEqual(header.getBoundingClientRect().bottom - 1);
  await page.getByRole('tab', { name: '插件', exact: true }).click();
  await expect.poll(() => host.querySelector('.flower-plugin-empty')).not.toBeNull();
  const panel = host.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
  expect(panel.querySelector('h2')).toBeNull();
  expect(panel.textContent).not.toContain('为 Flower 安装');
  expect(panel.textContent).not.toContain('环境：');
  expect(panel.querySelector('.flower-plugin-empty p')).toBeNull();
  expect(panel.querySelector('.flower-plugin-empty h3')?.textContent).toBe('暂无插件');
  expect(panel.querySelector('input[type="search"]')).toBeNull();
  await expect.element(page.getByRole('button', { name: '安装插件', exact: true })).toBeVisible();
  noOverflow();
});

it('hides discovery until a catalog is configured', async () => {
  const state = await mount();
  await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await expect.element(page.getByRole('heading', { name: 'No plugins yet', exact: true })).toBeVisible();
  expect(host.querySelector('.flower-plugin-segments')).toBeNull();
  await expect.element(page.getByRole('textbox', { name: 'Catalog URL', exact: true })).not.toBeInTheDocument();
  expect(state.adapter.plugins.catalog).not.toHaveBeenCalled();
  await expect.element(page.getByRole('button', { name: 'Install plugin', exact: true })).toBeVisible();
});

it('gives every entry a compact, stable identity icon across filtering and tabs', async () => {
  await mount();
  await expect.element(page.getByRole('heading', { name: 'code-review', exact: true })).toBeVisible();
  const first = host.querySelector<HTMLElement>('.flower-extension-icon');
  expect(first).not.toBeNull();
  expect(first).toHaveAttribute('aria-hidden', 'true');
  expect(first!.textContent).toBe('CR');
  const identity = first!.outerHTML;
  expect(first!.getBoundingClientRect().width).toBe(32);
  expect(host.querySelectorAll('.flower-extension-icon')).toHaveLength(skills.length);
  await page.getByRole('textbox', { name: 'Search', exact: true }).fill('technical');
  await page.getByRole('textbox', { name: 'Search', exact: true }).fill('');
  expect(host.querySelector('.flower-extension-icon')!.outerHTML).toBe(identity);
  await page.getByRole('tab', { name: 'MCP', exact: true }).click();
  await expect.element(page.getByRole('heading', { name: 'Workspace tools', exact: true })).toBeVisible();
  const icons = host.querySelectorAll('[role="tabpanel"]:not([hidden]) .flower-extension-icon');
  expect(icons).toHaveLength(2);
  expect(icons[0].textContent).toBe('WT');
  expect(icons[1].textContent).toBe('LW');
});

it.each([false, true])('uses supplied skill and MCP icons and reacts to theme changes (dark=%s)', async dark => {
  await mount(1280, dark, 'en-US', false, 0, adapter => {
    vi.mocked(adapter.listSkills).mockResolvedValue({ catalog_version: 1, skills: [{ ...skills[0], icons: [{ src: suppliedSkillIcon }] }, ...skills.slice(1)] });
    vi.mocked(adapter.listMCP).mockResolvedValue({ servers: [{ ...server, icons: [{ src: suppliedMCPIcon(false), theme: 'light' }, { src: suppliedMCPIcon(true), theme: 'dark' }] }] });
  });
  const skillImage = () => host.querySelector<HTMLImageElement>('.flower-extension-icon img');
  await expect.poll(() => skillImage()?.naturalWidth).toBeGreaterThan(0);
  expect(skillImage()).toHaveAttribute('src', suppliedSkillIcon);
  expect(skillImage()).toHaveAttribute('alt', '');
  expect(host.querySelector('.flower-extension-icon svg')).toBeNull();
  await page.screenshot({ path: `__screenshots__/flower-extension-icons/skills-${dark ? 'dark' : 'light'}.png` });
  await page.getByRole('tab', { name: 'MCP', exact: true }).click();
  const serverImage = () => host.querySelector<HTMLImageElement>('[role="tabpanel"]:not([hidden]) .flower-extension-icon img');
  await expect.poll(() => serverImage()?.naturalWidth).toBeGreaterThan(0);
  expect(serverImage()).toHaveAttribute('src', suppliedMCPIcon(dark));
  await page.screenshot({ path: `__screenshots__/flower-extension-icons/mcp-${dark ? 'dark' : 'light'}.png` });
  theme.setTheme(dark ? 'light' : 'dark');
  await expect.poll(() => serverImage()?.getAttribute('src')).toBe(suppliedMCPIcon(!dark));
  await expect.poll(() => serverImage()?.naturalWidth).toBeGreaterThan(0);
  noOverflow();
});

it('falls back on unavailable, malformed, or mismatched icons without hiding an entry', async () => {
  await mount(390, false, 'en-US', false, 0, adapter => {
    vi.mocked(adapter.listSkills).mockResolvedValue({ catalog_version: 1, skills: [
      { ...skills[0], icons: [{ src: 'data:image/png;base64,aW52YWxpZA==' }] },
      { ...skills[1], icons: [{ src: 'https://example.com/track.svg' }] },
      { ...skills[2], icons: [{ src: suppliedMCPIcon(true), theme: 'dark' }] },
    ] });
    vi.mocked(adapter.listMCP).mockResolvedValue({ servers: [{ ...server, icons: [{ src: 'data:image/png;base64,aW52YWxpZA==', theme: 'light' }, { src: suppliedSkillIcon }] }] });
  });
  await expect.element(page.getByRole('heading', { name: 'code-review', exact: true })).toBeVisible();
  await expect.poll(() => host.querySelectorAll('.flower-extension-icon img').length).toBe(0);
  expect([...host.querySelectorAll('.flower-extension-icon')].map(icon => icon.textContent)).toEqual(['CR', 'ER', 'TW']);
  noOverflow();
  await page.getByRole('tab', { name: 'MCP', exact: true }).click();
  const image = () => host.querySelector<HTMLImageElement>('[role="tabpanel"]:not([hidden]) .flower-extension-icon img');
  await expect.poll(() => image()?.naturalWidth).toBeGreaterThan(0);
  expect(image()).toHaveAttribute('src', suppliedSkillIcon);
  expect(host.querySelector('[role="tabpanel"]:not([hidden]) .flower-extension-row')!.getBoundingClientRect().height).toBeLessThanOrEqual(112);
});

it.each([[1280, false, 'en-US'], [1280, true, 'en-US'], [390, false, 'zh-CN'], [390, true, 'de-DE']] as const)('renders both tabs without overflow at %ipx (dark=%s, locale=%s)', async (width, dark, locale) => {
  await mount(width, dark, locale);
  await expect.element(page.getByRole('heading', { name: 'code-review', exact: true })).toBeVisible();
  noOverflow();
  expect(host.querySelector('.flower-extension-disclosure')).toHaveAttribute('aria-expanded', 'false');
  expect(host.querySelectorAll('.flower-extension-row')[1].textContent).not.toContain(extensionI18n(locale).t('common.actions.delete'));
  await page.screenshot({ path: `__screenshots__/flower-extensions/skills-${width}-${dark ? 'dark' : 'light'}-${locale}.png` });
  await page.getByRole('tab', { name: 'MCP', exact: true }).click();
  await expect.element(page.getByRole('heading', { name: 'Workspace tools', exact: true })).toBeVisible();
  noOverflow();
  await page.screenshot({ path: `__screenshots__/flower-extensions/mcp-${width}-${dark ? 'dark' : 'light'}-${locale}.png` });
});

it('retains filters across keyboard tab changes and keeps row actions keyboard accessible', async () => {
  const state = await mount();
  await page.getByRole('textbox', { name: 'Search', exact: true }).fill('code-review');
  await page.getByRole('button', { name: 'More actions: code-review', exact: true }).click();
  await expect.element(page.getByRole('menuitem', { name: 'Reinstall', exact: true })).toBeVisible();
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByRole('button', { name: 'More actions: code-review', exact: true })).toHaveFocus();
  const tab = page.getByRole('tab', { name: 'Skills', exact: true });
  await tab.click(); await userEvent.keyboard('{ArrowRight}');
  await expect.element(page.getByRole('tab', { name: 'MCP', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('searchbox', { name: 'Search servers' }).fill('workspace');
  await page.getByRole('tab', { name: 'MCP', exact: true }).click(); await userEvent.keyboard('{Home}');
  await expect.element(page.getByRole('textbox', { name: 'Search', exact: true })).toHaveValue('code-review');
  expect(state.adapter.listSkills).toHaveBeenCalledTimes(1);
  await page.getByRole('button', { name: 'Browse: code-review', exact: true }).click();
  await expect.element(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'SKILL.md', exact: true }).click();
  await expect.element(page.getByText('# Code review', { exact: true })).toBeVisible();
});

it('creates and checks a server, preserves failed edits, and confirms removal', async () => {
  const state = await mount(390);
  await page.getByRole('tab', { name: 'MCP', exact: true }).click();
  await page.getByRole('button', { name: 'Add server', exact: true }).click();
  const dialog = page.getByRole('dialog');
  expect(document.querySelector<HTMLDetailsElement>('[role="dialog"] details')?.open).toBe(false);
  await dialog.getByRole('textbox', { name: 'Endpoint URL', exact: true }).fill('https://project.example.com/mcp');
  const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
  expectSingleInputFocus(input);
  await expect.poll(() => getComputedStyle(document.querySelector('[role="dialog"]')!).opacity).toBe('1');
  await page.screenshot({ path: '__screenshots__/flower-extensions/add-server-mobile.png' });
  await dialog.getByRole('button', { name: 'Add server', exact: true }).click();
  await expect.element(page.getByRole('heading', { name: 'Project tools', exact: true })).toBeVisible();
  expect(state.saveMCP).toHaveBeenCalledWith(expect.objectContaining({ id: undefined, name: undefined, transport: 'http', enabled: true }));
  await page.getByRole('button', { name: 'More actions: Project tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Check connection', exact: true }).click();
  await expect.poll(() => state.adapter.checkMCP).toHaveBeenCalledWith({ id: 'mcp_generated', revision: 1 });
  await page.getByRole('button', { name: 'Edit server: Project tools', exact: true }).click();
  state.saveMCP.mockRejectedValueOnce(new Error('Connection unavailable'));
  await dialog.getByText('Advanced', { exact: true }).click();
  await expect.element(dialog.getByRole('textbox', { name: 'Server ID', exact: true })).toHaveAttribute('readonly');
  await expect.element(dialog.getByRole('textbox', { name: 'Server ID', exact: true })).toHaveValue('mcp_generated');
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Edited tools');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.element(dialog.getByRole('alert')).toHaveTextContent('Connection unavailable');
  await expect.element(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Edited tools');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'More actions: Project tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  expect(state.deleteMCP).not.toHaveBeenCalled();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => state.deleteMCP).toHaveBeenCalledWith({ id: 'mcp_generated', revision: 1 });
});

it.each([[1280, false, 'en-US'], [390, true, 'zh-CN'], [320, false, 'zh-TW']] as const)('keeps the MCP connection form concise at %ipx in %s %s', async (width, dark, locale) => {
  const state = await mount(width, dark, locale);
  const t = (key: string) => extensionI18n(locale).t(key);
  await page.getByRole('tab', { name: 'MCP', exact: true }).click();
  await page.getByRole('button', { name: t('add'), exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect.element(dialog.getByRole('button', { name: t('add'), exact: true })).toBeDisabled();
  expect(document.querySelector<HTMLDetailsElement>('[role="dialog"] details')?.open).toBe(false);
  await dialog.getByRole('textbox', { name: t('endpoint'), exact: true }).fill('https://project.example.com/mcp');
  expect(state.saveMCP).not.toHaveBeenCalled();
  expect(state.adapter.checkMCP).not.toHaveBeenCalled();
  await expect.element(dialog.getByRole('button', { name: t('add'), exact: true })).toBeEnabled();
  const element = document.querySelector<HTMLElement>('[role="dialog"]')!;
  await expect.poll(() => getComputedStyle(element).opacity).toBe('1');
  expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth + 1);
  await page.screenshot({ path: '__screenshots__/flower-mcp/add-' + width + '-' + locale + '.png' });
  await dialog.getByText(t('advanced'), { exact: true }).click();
  await expect.element(dialog.getByRole('textbox', { name: t('name'), exact: true })).toHaveAttribute('placeholder', t('automatic'));
  await dialog.getByRole('textbox', { name: t('name'), exact: true }).fill('项目工具');
  await dialog.getByRole('textbox', { name: t('identifier'), exact: true }).fill('docs');
  await page.screenshot({ path: '__screenshots__/flower-mcp/advanced-' + width + '-' + locale + '.png' });
  await dialog.getByRole('button', { name: t('add'), exact: true }).click();
  await expect.poll(() => state.saveMCP).toHaveBeenCalledWith(expect.objectContaining({ id: 'docs', name: '项目工具' }));
});

it('retains a failed connection-only draft for retry and resets advanced options when reopened', async () => {
  const state = await mount();
  await page.getByRole('tab', { name: 'MCP', exact: true }).click();
  await page.getByRole('button', { name: 'Add server', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Endpoint URL', exact: true }).fill('https://project.example.com/mcp');
  state.saveMCP.mockRejectedValueOnce(new Error('Connection unavailable'));
  await dialog.getByRole('button', { name: 'Add server', exact: true }).click();
  await expect.element(dialog.getByRole('alert')).toHaveTextContent('Connection unavailable');
  await expect.element(dialog.getByRole('textbox', { name: 'Endpoint URL', exact: true })).toHaveValue('https://project.example.com/mcp');
  await dialog.getByRole('button', { name: 'Add server', exact: true }).click();
  await expect.element(dialog).not.toBeInTheDocument();
  expect(state.saveMCP).toHaveBeenCalledTimes(2);
  expect(state.saveMCP.mock.calls[0]).toEqual(state.saveMCP.mock.calls[1]);
  await page.getByRole('button', { name: 'Edit server: Project tools', exact: true }).click();
  await dialog.getByText('Advanced', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Add server', exact: true }).click();
  expect(document.querySelector<HTMLDetailsElement>('[role="dialog"] details')?.open).toBe(false);
});

it('adds a local command without naming it and discloses execution only for local connections', async () => {
  const state = await mount(390, true);
  await page.getByRole('tab', { name: 'MCP', exact: true }).click();
  await page.getByRole('button', { name: 'Add server', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Remote HTTP', exact: true }).click();
  await page.getByText('Local command', { exact: true }).click();
  await expect.element(page.getByText('Remote HTTP', { exact: true })).not.toBeInTheDocument();
  await expect.element(dialog.getByText('Saving starts this command on the environment host.', { exact: true })).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Executable', exact: true }).fill('project-mcp');
  await dialog.getByRole('textbox', { name: 'Arguments', exact: true }).fill('--workspace\n/project');
  expect(state.saveMCP).not.toHaveBeenCalled();
  await page.screenshot({ path: '__screenshots__/flower-mcp/local-390-dark.png' });
  await dialog.getByRole('button', { name: 'Add server', exact: true }).click();
  await expect.poll(() => state.saveMCP).toHaveBeenCalledWith(expect.objectContaining({ id: undefined, name: undefined, transport: 'stdio', command: 'project-mcp', args: ['--workspace', '/project'] }));
});

it('keeps disabled servers disabled when edited and never fills saved credentials', async () => {
  const state = await mount();
  await page.getByRole('tab', { name: 'MCP', exact: true }).click();
  await page.getByRole('button', { name: 'Edit server: Local workspace', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Advanced', { exact: true }).click();
  await expect.element(dialog.getByRole('textbox', { name: 'Environment variables (JSON)', exact: true })).toHaveValue('');
  await expect.element(dialog.getByText('Saved keys: API_KEY', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => state.saveMCP).toHaveBeenCalledWith(expect.objectContaining({ id: 'local', enabled: false, env: undefined }));
});

it('keeps management read-only while allowing browsing and tab navigation', async () => {
  const state = await mount(); state.setAdmin(false);
  await expect.element(page.getByRole('button', { name: 'Create Skill', exact: true })).toBeDisabled();
  await expect.element(page.getByRole('button', { name: 'Browse: code-review', exact: true }).first()).not.toBeDisabled();
  await page.getByRole('tab', { name: 'MCP', exact: true }).click();
  await expect.element(page.getByRole('button', { name: 'Add server', exact: true })).toBeDisabled();
  await expect.element(page.getByRole('switch', { name: 'Workspace tools: Enabled', exact: true })).toBeDisabled();
  await expect.element(page.getByRole('button', { name: 'Edit server: Workspace tools', exact: true })).toBeDisabled();
  expect(state.saveMCP).not.toHaveBeenCalled();
});

it('offers clear first-use actions for an empty library', async () => {
  await mount(390, false, 'en-US', true);
  await expect.element(page.getByRole('heading', { name: 'No skills yet', exact: true })).toBeVisible();
  const skillsDrawing = host.querySelector('[role="tab"][id$="-skills-tab"] svg')?.innerHTML;
  expect(skillsDrawing).toBeTruthy();
  expect(host.querySelector('.flower-extension-empty-icon svg')?.innerHTML).toBe(skillsDrawing);
  await page.getByRole('tab', { name: 'MCP', exact: true }).click();
  await expect.element(page.getByRole('heading', { name: 'No servers yet', exact: true })).toBeVisible();
  const mcpDrawing = host.querySelector('[role="tab"][id$="-mcp-tab"] svg')?.innerHTML;
  expect(mcpDrawing).toBeTruthy();
  expect(host.querySelector('[role="tabpanel"]:not([hidden]) .flower-extension-empty-icon svg')?.innerHTML).toBe(mcpDrawing);
  await page.screenshot({ path: '__screenshots__/flower-extensions/empty-mobile.png' });
});


it.each([1280, 960])('shows at least nine complete entries at %ipx for large libraries', async width => {
  await mount(width, false, 'en-US', false, 40);
  for (const tab of ['Skills', 'MCP']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await expect.poll(() => host.querySelectorAll('[role="tabpanel"]:not([hidden]) .flower-extension-row').length).toBe(40);
    const rows = [...host.querySelectorAll<HTMLElement>('[role="tabpanel"]:not([hidden]) .flower-extension-row')];
    const viewport = host.getBoundingClientRect();
    const visible = rows.filter(row => { const box = row.getBoundingClientRect(); return box.top >= viewport.top && box.bottom <= viewport.bottom; });
    expect(visible.length).toBeGreaterThanOrEqual(9);
    expect(rows[0].getBoundingClientRect().height).toBeLessThanOrEqual(72);
    noOverflow();
    await page.screenshot({ path: `__screenshots__/flower-extensions/dense-${tab}-${width}.png` });
  }
});


it('discloses full descriptions and tool details without expanding neighboring rows', async () => {
  await mount(390);
  const description = host.querySelector<HTMLElement>('.flower-extension-identity p')!;
  expect(description.scrollWidth).toBeGreaterThan(description.clientWidth);
  expect(description.title).toBe(skills[0].description);
  const disclosure = page.getByRole('button', { name: 'Details: code-review', exact: true });
  await disclosure.click();
  await expect.element(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect.element(page.getByText(skills[0].path, { exact: true })).toBeVisible();
  expect(host.querySelectorAll('[data-expanded="true"]')).toHaveLength(1);
  await disclosure.click();
  await expect.element(page.getByText(skills[0].path, { exact: true })).not.toBeInTheDocument();
  await page.getByRole('tab', { name: 'MCP', exact: true }).click();
  await page.getByRole('button', { name: 'Details: Workspace tools', exact: true }).click();
  await expect.element(page.getByText('find_document', { exact: true })).toBeVisible();
  await expect.element(page.getByText('create_task', { exact: true })).toBeVisible();
  noOverflow();
});


it.each([320, 390])('keeps compact rows usable with touch input at %ipx', async width => {
  const touch = commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void> };
  await touch.emulateTouchInput(true);
  try {
    await mount(width, false, 'zh-CN', false, 40);
    for (const tab of ['技能', 'MCP']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await expect.poll(() => host.querySelectorAll('[role="tabpanel"]:not([hidden]) .flower-extension-row').length).toBe(40);
      noOverflow();
      const row = host.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden]) .flower-extension-row')!;
      for (const control of row.querySelectorAll<HTMLElement>('.flower-extension-disclosure, .flower-extension-row-control > button, .flower-extension-menu-button, .flower-extension-row-control > label')) {
        const rect = control.getBoundingClientRect();
        expect(rect.width).toBeGreaterThanOrEqual(44);
        expect(rect.height).toBeGreaterThanOrEqual(44);
      }
      expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(112);
      expect(row.querySelector('.flower-extension-identity')!.getBoundingClientRect().width).toBeGreaterThanOrEqual(200);
    }
    const scroller = host.querySelector<HTMLElement>('.flower-extensions-content')!;
    scroller.scrollTop = 650;
    const toolbar = host.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden]) .flower-extension-toolbar')!;
    await expect.poll(() => toolbar.getBoundingClientRect().top).toBeGreaterThanOrEqual(scroller.getBoundingClientRect().top);
    await expect.poll(() => toolbar.getBoundingClientRect().bottom).toBeLessThan(scroller.getBoundingClientRect().top + 110);
    scroller.scrollTop = 0;
    await page.screenshot({ path: `__screenshots__/flower-extensions/dense-touch-${width}.png` });
  } finally { await touch.emulateTouchInput(false); }
});

it('previews packages without execution, installs disabled, and retains filters across tabs', async () => {
  const state = await mount();
  await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await page.getByRole('button', { name: 'Install plugin', exact: true }).click();
  await page.getByRole('textbox', { name: 'GitHub repository', exact: true }).fill('example/tools');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect.element(page.getByText('review-tools 1.0', { exact: true })).toBeVisible();
  expect(state.adapter.plugins.check).not.toHaveBeenCalled();
  const previousSkillReads = vi.mocked(state.adapter.listSkills).mock.calls.length;
  await page.getByRole('checkbox', { name: 'mcp:workspace', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Install plugin', exact: true }).click();
  await expect.poll(() => state.adapter.plugins.commit).toHaveBeenCalledWith({ operation_id: 'op-1', digest: 'a'.repeat(64), enabled: false, components: ['skill:review'] });
  await expect.element(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => vi.mocked(state.adapter.listSkills).mock.calls.length).toBeGreaterThan(previousSkillReads);
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByRole('heading', { name: 'review-tools', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search plugins' }).fill('review');
  await page.getByRole('tab', { name: 'Skills', exact: true }).click();
  await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await expect.element(page.getByRole('searchbox', { name: 'Search plugins' })).toHaveValue('review');
  await page.getByRole('button', { name: 'Manage: review-tools', exact: true }).click();
  await page.getByRole('button', { name: 'Uninstall', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Uninstall', exact: true }).click();
  await expect.poll(() => state.adapter.plugins.remove).toHaveBeenCalledWith({ id: 'install-1', revision: 1, delete_data: false });
});

it('retains an installation draft after failure and blocks writes after admin revocation', async () => {
  const state = await mount();
  await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await page.getByRole('button', { name: 'Install plugin', exact: true }).click();
  await page.getByRole('textbox', { name: 'GitHub repository', exact: true }).fill('example/tools');
  vi.mocked(state.adapter.plugins.prepare).mockRejectedValueOnce(new Error('offline'));
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect.element(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await expect.element(page.getByRole('textbox', { name: 'GitHub repository', exact: true })).toHaveValue('example/tools');
  state.setAdmin(false);
  await expect.element(page.getByRole('button', { name: 'Preview', exact: true })).toBeDisabled();
});

it.each([[320, false, 'zh-TW'], [390, false, 'zh-CN'], [390, true, 'de-DE'], [1280, false, 'zh-CN'], [1280, true, 'zh-CN'], [1280, false, 'en-US']] as const)('renders plugin management at %ipx (dark=%s, locale=%s)', async (width, dark, locale) => {
  await mount(width, dark, locale); const i18n = extensionI18n(locale);
  await page.getByRole('tab', { name: i18n.t('plugins'), exact: true }).click();
  await expect.element(page.getByRole('heading', { name: i18n.t('plugins.emptyTitle'), exact: true })).toBeVisible();
  const tabs = [...host.querySelectorAll<HTMLElement>('[role="tab"]')];
  expect(tabs.map(tab => tab.querySelector('svg')?.innerHTML).filter((value, index, all) => all.indexOf(value) === index)).toHaveLength(3);
  const selected = tabs.find(tab => tab.getAttribute('aria-selected') === 'true')!;
  expect(getComputedStyle(selected, '::after').height).toBe('2px');
  expect(getComputedStyle(selected, '::after').backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(host.querySelector('.flower-plugin-segments')).toBeNull();
  for (const tab of tabs) {
    const box = tab.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(width);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  noOverflow();
  await page.screenshot({ path: '__screenshots__/flower-plugins/plugins-' + width + '-' + locale + '-' + dark + '.png' });
});

it.each([[1280, false], [1280, true], [390, false], [390, true]] as const)('presents a focused plugin gallery and detail dialog at %ipx (dark=%s)', async (width, dark) => {
  await mount(width, dark, 'en-US', false, 0, adapter => {
    vi.mocked(adapter.plugins.list).mockResolvedValue({ revision: 1, target: 'Development', can_launch: true, sources: [], operations: [], items: [
      { id: 'design', revision: 1, enabled: true, source: { type: 'github', repository: 'studio/design-tools' }, digest: 'a'.repeat(64), package: { manifest: { name: 'design-tools', version: '1.2.0', description: 'Create consistent interfaces with your team’s design system.' }, skills: [{ key: 'skill:review', name: 'review', description: 'Review interface consistency.', path: 'skills/review/SKILL.md' }], mcp: { workspace: { type: 'streamable-http', url: 'https://tools.example.com/mcp' } }, diagnostics: [] }, components: { 'skill:review': { enabled: true }, 'mcp:workspace': { enabled: true } }, health: { 'skill:review': { status: 'ready', checked_at: 0, tools: 0 }, 'mcp:workspace': { status: 'ready', checked_at: 1, tools: 4 } } },
      { id: 'research', revision: 1, enabled: false, source: { type: 'github', repository: 'studio/research' }, digest: 'b'.repeat(64), package: { manifest: { name: 'research-companion', version: '2.0', description: 'Gather sources and turn findings into clear, cited research.' }, skills: [], mcp: {}, diagnostics: [] }, components: {} },
    ] });
  });
  await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await expect.element(page.getByRole('heading', { name: 'design-tools', exact: true })).toBeVisible();
  noOverflow();
  await page.screenshot({ path: '__screenshots__/flower-plugins/gallery-' + width + '-' + dark + '.png' });
  await page.getByRole('button', { name: 'Manage: design-tools', exact: true }).click();
  await expect.element(page.getByRole('dialog')).toBeVisible();
  await expect.element(page.getByText('Components', { exact: true })).toBeVisible();
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
  await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined)));
  await page.screenshot({ path: '__screenshots__/flower-plugins/detail-' + width + '-' + dark + '.png' });
});

it('keeps plugin search misses distinct from an uninstalled library', async () => {
  const state = await mount();
  await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await page.getByRole('button', { name: 'Install plugin', exact: true }).click();
  await page.getByRole('textbox', { name: 'GitHub repository', exact: true }).fill('example/tools');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Install plugin', exact: true }).click();
  await expect.poll(() => state.adapter.plugins.commit).toHaveBeenCalled();
  await userEvent.keyboard('{Escape}');
  await page.getByRole('searchbox', { name: 'Search plugins' }).fill('missing-package');
  await expect.element(page.getByRole('heading', { name: 'No matching plugins', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect.element(page.getByRole('searchbox', { name: 'Search plugins' })).toHaveValue('');
  await expect.element(page.getByRole('heading', { name: 'review-tools', exact: true })).toBeVisible();
});

it('preserves keyboard tab navigation and focus in the separate primary bar', async () => {
  await mount(390);
  await page.getByRole('tab', { name: 'Skills', exact: true }).click();
  await userEvent.keyboard('{End}');
  await expect.element(page.getByRole('tab', { name: 'Plugins', exact: true })).toHaveFocus();
  await expect.element(page.getByRole('tab', { name: 'Plugins', exact: true })).toHaveAttribute('aria-selected', 'true');
  await userEvent.keyboard('{ArrowLeft}');
  await expect.element(page.getByRole('tab', { name: 'MCP', exact: true })).toHaveFocus();
  await userEvent.keyboard('{Home}');
  await expect.element(page.getByRole('tab', { name: 'Skills', exact: true })).toHaveFocus();
  expect(host.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
});

it('edits plugin credentials through named secret fields and clears them explicitly', async () => {
  const state = await mount();
  await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await page.getByRole('button', { name: 'Install plugin', exact: true }).click();
  await page.getByRole('textbox', { name: 'GitHub repository', exact: true }).fill('example/tools');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Install plugin', exact: true }).click();
  await page.getByRole('button', { name: 'Credentials', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('API_KEY');
  const secret = page.getByLabelText('Secret value', { exact: true });
  await expect.element(secret).toHaveAttribute('type', 'password');
  await secret.fill('fixture-secret');
  await page.getByRole('button', { name: 'Replace credentials', exact: true }).click();
  await expect.poll(() => state.adapter.plugins.credentials).toHaveBeenCalledWith({ id: 'install-1', revision: 1, component: 'mcp:workspace', values: { API_KEY: 'fixture-secret' } });
  await page.getByRole('button', { name: 'Credentials', exact: true }).click();
  await expect.element(page.getByLabelText('Secret value', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Clear saved credentials', exact: true }).click();
  await expect.poll(() => state.adapter.plugins.credentials).toHaveBeenLastCalledWith({ id: 'install-1', revision: 1, component: 'mcp:workspace', values: {} });
});

it('keeps a dismissed preparation closed when a poll finishes and allows resuming it', async () => {
  let finish: ((operation: Awaited<ReturnType<FlowerExtensionsAdapter['plugins']['operation']>>) => void) | undefined;
  const op = { id: 'pending-operation', kind: 'install', status: 'preparing', install_id: 'pending-install', expected_revision: 0, source: { type: 'github' as const, repository: 'example/tools' }, expires_at: Date.now() + 60000 };
  const state = await mount(1280, false, 'en-US', false, 0, adapter => {
    vi.mocked(adapter.plugins.prepare).mockResolvedValue(op);
    vi.mocked(adapter.plugins.operation).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    vi.mocked(adapter.plugins.list).mockResolvedValue({ items: [], operations: [op], sources: [], revision: 1, target: 'Development', can_launch: true });
  });
  await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect.poll(() => state.adapter.plugins.operation, { timeout: 4000 }).toHaveBeenCalled();
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  finish?.({ ...op, status: 'failed' });
  await new Promise(resolve => setTimeout(resolve, 30));
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect.element(page.getByRole('textbox', { name: 'GitHub repository', exact: true })).toHaveValue('example/tools');
});

it('discovers packages through managed sources and reviews their source', async () => {
  const state = await mount();
  await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await page.getByRole('button', { name: 'Manage sources', exact: true }).click();
  await page.getByRole('textbox', { name: 'Catalog URL', exact: true }).fill('https://catalog.example.com/plugins.json');
  await page.getByRole('button', { name: 'Add catalog', exact: true }).click();
  await expect.element(page.getByText('Trusted catalog', { exact: true })).toBeVisible();
  await userEvent.keyboard('{Escape}');
  await page.getByRole('button', { name: 'Discover', exact: true }).click();
  await expect.element(page.getByRole('heading', { name: 'review-tools', exact: true })).toBeVisible();
  expect(state.adapter.plugins.prepare).not.toHaveBeenCalled();
  await page.getByRole('button', { name: 'Install plugin', exact: true }).last().click();
  await expect.element(page.getByRole('textbox', { name: 'GitHub repository', exact: true })).toHaveValue('example/tools');
  expect(state.adapter.plugins.commit).not.toHaveBeenCalled();
});

it.each([[1280, false, 'en-US'], [390, true, 'zh-CN'], [320, false, 'de-DE']] as const)('browses a configured catalog at %ipx (dark=%s, locale=%s)', async (width, dark, locale) => {
  const i18n = extensionI18n(locale);
  const state = await mount(width, dark, locale, false, 0, adapter => {
    vi.mocked(adapter.plugins.list).mockResolvedValue({ items: [], sources: [{ id: 'configured:team', name: 'Team extensions', url: 'https://example.com/plugins.json', managed: true }], operations: [], revision: 1, target: 'Development', can_launch: true });
    vi.mocked(adapter.plugins.catalog).mockResolvedValue({ id: 'team', plugins: [{ id: 'review', display: { name: 'Code review', description: 'Review changes with your team.', author: 'Example' }, source: { type: 'github', repository: 'example/tools', ref: 'stable', path: 'plugins/review' } }] });
  });
  await page.getByRole('tab', { name: i18n.t('plugins'), exact: true }).click();
  expect(state.adapter.plugins.catalog).not.toHaveBeenCalled();
  await page.getByRole('button', { name: i18n.t('plugins.discover'), exact: true }).click();
  await expect.element(page.getByRole('heading', { name: 'Code review', exact: true })).toBeVisible();
  expect(state.adapter.plugins.catalog).toHaveBeenCalledWith('configured:team');
  expect(host.querySelector('.flower-plugin-source-form')).toBeNull();
  const active = host.querySelector<HTMLElement>('.flower-plugin-segments [aria-pressed="true"]')!;
  const inactive = host.querySelector<HTMLElement>('.flower-plugin-segments [aria-pressed="false"]')!;
  expect(getComputedStyle(active).backgroundColor).not.toBe(getComputedStyle(inactive).backgroundColor);
  noOverflow();
  await page.screenshot({ path: '__screenshots__/flower-plugins/catalog-' + width + '-' + locale + '.png' });
  await page.getByRole('searchbox', { name: i18n.t('plugins.search') }).fill('missing');
  await expect.element(page.getByRole('heading', { name: i18n.t('plugins.noResults'), exact: true })).toBeVisible();
  await page.getByRole('button', { name: i18n.t('clear'), exact: true }).click();
  await page.getByRole('button', { name: i18n.t('plugins.manageSources'), exact: true }).click();
  await expect.element(page.getByText(i18n.t('plugins.managedSource'), { exact: true })).toBeVisible();
  expect(document.querySelector('[role="dialog"] button[aria-label^="' + i18n.t('plugins.removeSource') + '"]')).toBeNull();
  await userEvent.keyboard('{Escape}');
  await page.getByRole('button', { name: i18n.t('plugins.install'), exact: true }).last().click();
  await expect.element(page.getByRole('textbox', { name: i18n.t('plugins.path'), exact: true })).toHaveValue('plugins/review');
  await page.getByRole('button', { name: i18n.t('plugins.preview'), exact: true }).click();
  await expect.element(page.getByText('review-tools 1.0', { exact: true })).toBeVisible();
  expect(state.adapter.plugins.prepare).toHaveBeenCalledWith(expect.objectContaining({ source: { type: 'github', repository: 'example/tools', ref: 'stable', path: 'plugins/review' } }));
});

it('retries failed catalogs without hiding installed management and respects read-only access', async () => {
  const state = await mount(390, false, 'en-US', false, 0, adapter => {
    vi.mocked(adapter.plugins.list).mockResolvedValue({ items: [], sources: [{ id: 'configured:team', name: 'Team', url: 'https://example.com/plugins.json', managed: true }], operations: [], revision: 1, target: 'Development', can_launch: true });
    vi.mocked(adapter.plugins.catalog).mockRejectedValueOnce(new Error('offline'));
  });
  state.setAdmin(false);
  await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await page.getByRole('button', { name: 'Discover', exact: true }).click();
  await expect.element(page.getByText('Unable to load catalog', { exact: true })).toBeVisible();
  await expect.element(page.getByText('No plugins in this catalog', { exact: true })).not.toBeInTheDocument();
  await page.getByRole('button', { name: 'Installed', exact: true }).click();
  await expect.element(page.getByRole('heading', { name: 'No plugins yet', exact: true })).toBeVisible();
  vi.mocked(state.adapter.plugins.catalog).mockRejectedValueOnce(new Error('offline'));
  await page.getByRole('button', { name: 'Discover', exact: true }).click();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.element(page.getByRole('heading', { name: 'review-tools', exact: true })).toBeVisible();
  await expect.element(page.getByRole('button', { name: 'Install plugin', exact: true }).last()).toBeDisabled();
});

it('removes the final custom source and hides discovery without losing plugin management', async () => {
  const state = await mount(390);
  await state.adapter.plugins.addSource({ url: 'https://example.com/plugins.json', revision: 1 });
  await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await page.getByRole('button', { name: 'Discover', exact: true }).click();
  await expect.element(page.getByRole('heading', { name: 'review-tools', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Manage sources', exact: true }).click();
  await page.getByRole('button', { name: 'Remove catalog: Trusted catalog', exact: true }).click();
  await expect.poll(() => state.adapter.plugins.removeSource).toHaveBeenCalled();
  await expect.element(page.getByText('Trusted catalog', { exact: true })).not.toBeInTheDocument();
  await expect.element(page.getByRole('textbox', { name: 'Catalog URL', exact: true })).toBeEnabled();
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByRole('heading', { name: 'No plugins yet', exact: true })).toBeVisible();
  expect(host.querySelector('.flower-plugin-segments')).toBeNull();
});

it('retains discovery filters and ignores a response after leaving discovery', async () => {
  let finish: ((catalog: Awaited<ReturnType<FlowerExtensionsAdapter['plugins']['catalog']>>) => void) | undefined;
  await mount(390, false, 'en-US', false, 0, adapter => {
    vi.mocked(adapter.plugins.list).mockResolvedValue({ items: [], sources: [{ id: 'team', name: 'Team', url: 'https://example.com/plugins.json' }], operations: [], revision: 1, target: 'Development', can_launch: true });
    vi.mocked(adapter.plugins.catalog).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  });
  await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await page.getByRole('button', { name: 'Discover', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search plugins' }).fill('review');
  await page.getByRole('button', { name: 'Installed', exact: true }).click();
  finish?.({ id: 'team', plugins: [] });
  await expect.element(page.getByRole('heading', { name: 'No plugins yet', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Discover', exact: true }).click();
  await expect.element(page.getByRole('searchbox', { name: 'Search plugins' })).toHaveValue('review');
  await expect.element(page.getByRole('heading', { name: 'review-tools', exact: true })).toBeVisible();
});

it('retains failed source input and keeps the source dialog within a narrow viewport', async () => {
  const state = await mount(320, true, 'zh-TW');
  const i18n = extensionI18n('zh-TW');
  await page.getByRole('tab', { name: i18n.t('plugins'), exact: true }).click();
  await page.getByRole('button', { name: i18n.t('plugins.manageSources'), exact: true }).click();
  const address = 'https://catalog.example.com/plugins.json';
  await page.getByRole('textbox', { name: i18n.t('plugins.catalogURL'), exact: true }).fill(address);
  vi.mocked(state.adapter.plugins.addSource).mockRejectedValueOnce(new Error('offline'));
  await page.getByRole('button', { name: i18n.t('plugins.addSource'), exact: true }).click();
  await expect.element(page.getByText(i18n.t('plugins.failed'), { exact: true })).toBeVisible();
  await expect.element(page.getByRole('textbox', { name: i18n.t('plugins.catalogURL'), exact: true })).toHaveValue(address);
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
  await page.screenshot({ path: '__screenshots__/flower-plugins/sources-320-zh-TW.png' });
  state.setAdmin(false);
  await expect.element(page.getByRole('button', { name: i18n.t('plugins.addSource'), exact: true })).not.toBeInTheDocument();
});

it('opens the same plugin owner repeatedly from its skill projection', async () => {
  const state = await mount();
  await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
  await page.getByRole('button', { name: 'Install plugin', exact: true }).click();
  await page.getByRole('textbox', { name: 'GitHub repository', exact: true }).fill('example/tools');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  vi.mocked(state.adapter.listSkills).mockResolvedValue({ catalog_version: 2, skills: [{ ...skills[0], name: 'review-tools@install-1/review', scope: 'agent_plugin', plugin_id: 'install-1', plugin_name: 'review-tools' }] });
  await page.getByRole('dialog').getByRole('button', { name: 'Install plugin', exact: true }).click();
  await expect.element(page.getByRole('dialog').getByRole('heading', { name: 'review-tools', exact: true })).toBeVisible();
  for (let attempt = 0; attempt < 2; attempt++) {
    await userEvent.keyboard('{Escape}');
    await page.getByRole('tab', { name: 'Skills', exact: true }).click();
    await page.getByRole('button', { name: 'Manage', exact: true }).click();
    await expect.element(page.getByRole('dialog').getByRole('heading', { name: 'review-tools', exact: true })).toBeVisible();
  }
});
