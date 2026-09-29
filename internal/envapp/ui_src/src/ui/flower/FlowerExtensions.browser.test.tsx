import '../../index.css';
import { FloeProvider } from '@floegence/floe-webapp-core';
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
    const next: MCPServer = { ...input, revision: input.revision + 1, header_keys: Object.keys(input.headers ?? {}), env_keys: Object.keys(input.env ?? {}), checked_at: server.checked_at, tools: server.tools };
    servers = [...servers.filter(item => item.id !== input.id), next]; return { servers };
  });
  const deleteMCP = vi.fn(async ({ id }: { id: string }) => { servers = servers.filter(item => item.id !== id); return { servers }; });
  const adapter: FlowerExtensionsAdapter = {
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
async function mount(width = 1280, dark = false, locale = 'en-US', empty = false, count = 0) {
  await page.viewport(width, 850);
  localStorage.removeItem('extensions-test-theme');
  const state = fixture(empty, count); host = document.createElement('div'); host.style.height = '830px'; document.body.append(host);
  dispose = render(() => <FloeProvider config={{ theme: { storageKey: 'extensions-test-theme', defaultTheme: dark ? 'dark' : 'light' } }}><FlowerExtensionsSurface adapter={state.adapter} i18n={extensionI18n(locale)} onBack={vi.fn()} /></FloeProvider>, host);
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

it.each([[1280, false, 'en-US'], [1280, true, 'en-US'], [390, false, 'zh-CN'], [390, true, 'de-DE']] as const)('renders both tabs without overflow at %ipx (dark=%s, locale=%s)', async (width, dark, locale) => {
  await mount(width, dark, locale);
  await expect.element(page.getByRole('heading', { name: 'code-review', exact: true })).toBeVisible();
  noOverflow();
  expect(host.querySelector('.flower-extension-disclosure')).toHaveAttribute('aria-expanded', 'false');
  expect(host.querySelectorAll('.flower-extension-row')[1].textContent).not.toContain(extensionI18n(locale).t('common.actions.delete'));
  await page.screenshot({ path: `../../../dist/flower-extensions/skills-${width}-${dark ? 'dark' : 'light'}-${locale}.png` });
  await page.getByRole('tab', { name: 'MCP', exact: true }).click();
  await expect.element(page.getByRole('heading', { name: 'Workspace tools', exact: true })).toBeVisible();
  noOverflow();
  await page.screenshot({ path: `../../../dist/flower-extensions/mcp-${width}-${dark ? 'dark' : 'light'}-${locale}.png` });
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
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Project tools');
  await expect.element(dialog.getByRole('textbox', { name: 'Server ID', exact: true })).toHaveValue('project-tools');
  await dialog.getByRole('textbox', { name: 'Endpoint URL', exact: true }).fill('https://project.example.com/mcp');
  const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
  expectSingleInputFocus(input);
  await expect.poll(() => getComputedStyle(document.querySelector('[role="dialog"]')!).opacity).toBe('1');
  await page.screenshot({ path: '../../../dist/flower-extensions/add-server-mobile.png' });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.element(page.getByRole('heading', { name: 'Project tools', exact: true })).toBeVisible();
  expect(state.saveMCP).toHaveBeenCalledWith(expect.objectContaining({ id: 'project-tools', transport: 'http', enabled: true }));
  await page.getByRole('button', { name: 'More actions: Project tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Check connection', exact: true }).click();
  await expect.poll(() => state.adapter.checkMCP).toHaveBeenCalledWith({ id: 'project-tools', revision: 1 });
  await page.getByRole('button', { name: 'Edit server: Project tools', exact: true }).click();
  state.saveMCP.mockRejectedValueOnce(new Error('Connection unavailable'));
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Edited tools');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.element(dialog.getByRole('alert')).toHaveTextContent('Connection unavailable');
  await expect.element(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Edited tools');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'More actions: Project tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  expect(state.deleteMCP).not.toHaveBeenCalled();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => state.deleteMCP).toHaveBeenCalledWith({ id: 'project-tools', revision: 1 });
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
  await expect.element(page.getByRole('heading', { name: 'Build your skill library', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'MCP', exact: true }).click();
  await expect.element(page.getByRole('heading', { name: 'Connect your first MCP server', exact: true })).toBeVisible();
  await page.screenshot({ path: '../../../dist/flower-extensions/empty-mobile.png' });
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
    await page.screenshot({ path: `../../../dist/flower-extensions/dense-${tab}-${width}.png` });
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
    await page.screenshot({ path: `../../../dist/flower-extensions/dense-touch-${width}.png` });
  } finally { await touch.emulateTouchInput(false); }
});
