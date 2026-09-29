// @vitest-environment jsdom
import { FlowerExtensionsContext, extensionI18n } from '../../../../../../flower_ui/src/extensions/context';
import { flowerExtensionsAdapter } from '../../../../../../flower_ui/host/extensionsAdapter';
import { FloeProvider } from '@floegence/floe-webapp-core';

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SkillsCatalogList } from '../../../../../../flower_ui/src/extensions/SkillsCatalogList';
import { extensionMonogram } from '../../../../../../flower_ui/src/extensions/ExtensionIcon';

vi.mock('@floegence/floe-webapp-core/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('@floegence/floe-webapp-core/ui')>(),
  createFloatingPresence: (options: { open: () => boolean }) => ({
    mounted: () => Boolean(options.open()),
    exiting: () => false,
    state: () => (options.open() ? 'entered' : 'exited'),
  }),
  Button: (props: any) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick} aria-label={props['aria-label']}>
      {props.children}
    </button>
  ),
  Dropdown: (props: any) => <div>{props.items.map((item: any) => <button disabled={item.disabled} onClick={() => props.onSelect(item.id)}>{item.label}</button>)}</div>,
  Switch: (props: any) => (
    <label>
      <input
        type="checkbox"
        checked={!!props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange?.((event.currentTarget as HTMLInputElement).checked)}
      />
      <span>{props.label}</span>
    </label>
  ),
  Tag: (props: any) => <span class={props.class}>{props.children}</span>,
}));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('SkillsCatalogList', () => {
  it.each([['code-review', 'CR'], ['workspaceTools', 'WT'], ['git', 'GI'], ['代码审查', '代码'], ['écriture technique', 'ÉT'], ['  ', '·']])('derives readable icon initials for %s', (name, expected) => {
    expect(extensionMonogram(name)).toBe(expected);
  });
  it('renders source metadata and routes skill actions', () => {
    const onToggle = vi.fn();
    const onBrowse = vi.fn();
    const onReinstall = vi.fn();
    const onDelete = vi.fn();

    const skills = [
      {
        id: 'skill-1',
        name: 'skill-installer',
        description: 'Install skills from GitHub.',
        path: '/skills/skill-installer',
        scope: 'user',
        enabled: true,
        effective: true,
        dependency_state: 'ok',
      },
      {
        id: 'skill-2',
        name: 'local-helper',
        description: 'Local helper skill.',
        path: '/skills/local-helper',
        scope: 'user_agents',
        enabled: false,
        effective: false,
        dependency_state: 'degraded',
        shadowed_by: '/skills/system/local-helper',
      },
    ];

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(
      () => (
        <FloeProvider><FlowerExtensionsContext.Provider value={{ ...flowerExtensionsAdapter(vi.fn(), { canInteract: () => true, canAdmin: () => true }), i18n: extensionI18n() }}><SkillsCatalogList
          skills={skills}
          sources={{
            '/skills/skill-installer': {
              skill_path: '/skills/skill-installer',
              source_type: 'github_import',
              source_id: 'openai/skills#skill-installer',
            },
            '/skills/local-helper': {
              skill_path: '/skills/local-helper',
              source_type: 'local_manual',
              source_id: 'manual',
            },
          }}
          loading={false}
          canInteract
          canAdmin
          toggleSaving={{}}
          reinstalling={{}}
          onToggle={onToggle}
          onBrowse={onBrowse}
          onReinstall={onReinstall}
          onDelete={onDelete}
        /></FlowerExtensionsContext.Provider></FloeProvider>
      ),
      host,
    );

    const toggles = host.querySelectorAll('input[type="checkbox"]');
    const secondToggle = toggles[1] as HTMLInputElement;
    secondToggle.checked = true;
    secondToggle.dispatchEvent(new Event('change', { bubbles: true }));

    const buttons = Array.from(host.querySelectorAll('button'));
    const browseButtons = buttons.filter((candidate) => candidate.getAttribute('aria-label')?.startsWith('Browse:'));
    const reinstallButton = buttons.find((candidate) => candidate.textContent?.trim() === 'Reinstall');
    const deleteButtons = buttons.filter((candidate) => candidate.textContent?.trim() === 'Delete');

    browseButtons[0]?.click();
    reinstallButton?.click();
    deleteButtons[1]?.click();

    (host.querySelector('button[aria-label="Details: skill-installer"]') as HTMLButtonElement).click();
    (host.querySelector('button[aria-label="Details: local-helper"]') as HTMLButtonElement).click();
    expect(host.textContent).toContain('GitHub import');
    expect(host.textContent).toContain('User (.redeven)');
    expect(host.textContent).toContain('User (.agents)');
    expect(host.textContent).toContain('Dependency degraded');
    expect(host.textContent).toContain('Shadowed by: /skills/system/local-helper');
    expect(onToggle).toHaveBeenCalledWith(skills[1], true);
    expect(onBrowse).toHaveBeenCalledWith(skills[0]);
    expect(onReinstall).toHaveBeenCalledWith(skills[0]);
    expect(onDelete).toHaveBeenCalledWith(skills[1]);
  });

  it('shows the empty-state message when filters return no skills', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(
      () => (
        <FlowerExtensionsContext.Provider value={{ ...flowerExtensionsAdapter(vi.fn(), { canInteract: () => true, canAdmin: () => true }), i18n: extensionI18n() }}><SkillsCatalogList
          skills={[]}
          sources={{}}
          loading={false}
          canInteract
          canAdmin
          toggleSaving={{}}
          reinstalling={{}}
          onToggle={() => undefined}
          onBrowse={() => undefined}
          onReinstall={() => undefined}
          onDelete={() => undefined}
        /></FlowerExtensionsContext.Provider>
      ),
      host,
    );

    expect(host.textContent).toContain('No skills found for current filters.');
  });
});
