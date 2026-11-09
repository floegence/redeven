// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsPanelContext } from '../../../../../../settings_ui/src/SettingsPanelHost';
import { createSettingsSession } from '../../../../../../settings_ui/src/settingsSession';

import {
  SettingRow,
  SettingsList,
  SettingsSection,
  SettingsResourceToolbar,
  SettingsTable,
  SettingsTableBody,
  SettingsTableCell,
  SettingsTableHead,
  SettingsTableHeaderCell,
  SettingsTableHeaderRow,
  SettingsTableRow,
} from './SettingsPrimitives';

describe('settings surface primitives', () => {
  const hosts: HTMLElement[] = [];
  const disposers: Array<() => void> = [];

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    for (const host of hosts.splice(0)) host.remove();
  });

  function mount(view: () => import('solid-js').JSX.Element): HTMLElement {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    disposers.push(render(view, host));
    return host;
  }

  it('keeps the section as a borderless layout group while inset content owns the boundary', () => {
    const host = mount(() => (
      <SettingsSection
        icon={(props) => <span class={props.class} />}
        title="Runtime"
        description="Runtime configuration"
      >
        <SettingsList>
          <SettingRow title="Shell" />
        </SettingsList>
      </SettingsSection>
    ));

    const section = host.querySelector('.redeven-settings-section');
    const list = host.querySelector('.redeven-settings-list');
    expect(section).not.toBeNull();
    expect(section?.classList.contains('border')).toBe(false);
    expect(section?.classList.contains('p-5')).toBe(false);
    expect(section?.classList.contains('shadow-sm')).toBe(false);
    expect(list?.classList.contains('floe-settings-list')).toBe(true);
    expect(section?.querySelector('.redeven-surface-panel')).toBeNull();
  });

  it('labels the resource selector and keeps refresh in the same scope', () => {
    const host = mount(() => <SettingsResourceToolbar label="Service" actions={<button>Refresh</button>}><select aria-label="Service"><option>API</option></select></SettingsResourceToolbar>);
    const group = host.querySelector('[role="group"]')!;
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent).toBe('Service');
    expect(group.querySelector('select')).not.toBeNull();
    expect(group.querySelector('button')?.textContent).toBe('Refresh');
  });

  it('constructs each product action slot once under its owner', () => {
    let toolbarActions = 0, sectionActions = 0;
    const ToolbarAction = () => { toolbarActions++; return <button>Refresh resource</button>; };
    const SectionAction = () => { sectionActions++; return <button>Inspect section</button>; };
    mount(() => <><SettingsResourceToolbar label="Resource" actions={<ToolbarAction />}><input /></SettingsResourceToolbar>
      <SettingsSection title="Section" actions={<SectionAction />}><input /></SettingsSection></>);
    expect(toolbarActions).toBe(1); expect(sectionActions).toBe(1);
  });

  it('leaves category identity to the dialog while preserving standalone and subgroup headings', () => {
    const standalone = mount(() => <SettingsSection variant="page" title="Runtime"><span>Standalone content</span></SettingsSection>);
    expect(standalone.querySelector('h1')?.textContent).toBe('Runtime');
    const hosted = mount(() => {
      const session = createSettingsSession();
      return <SettingsPanelContext.Provider value={{ ...session, register: () => () => {} }}>
        <SettingsSection variant="page" title="Runtime" description="Changes require restart" badge="Read only" actions={<button>Inspect</button>} error="Access denied">
          <span>Hosted content</span><SettingsSection title="Directories"><span>Subgroup content</span></SettingsSection>
        </SettingsSection>
      </SettingsPanelContext.Provider>;
    });
    expect(hosted.querySelector('h1')).toBeNull();
    expect([...hosted.querySelectorAll('h1, h2, h3')].map(node => node.textContent)).toEqual(['Directories']);
    expect(hosted.querySelector('section')?.getAttribute('aria-label')).toBe('Runtime');
    expect(hosted.textContent).toContain('Changes require restart');
    expect(hosted.textContent).toContain('Read only');
    expect(hosted.querySelector('button')?.textContent).toBe('Inspect');
    expect(hosted.querySelector('[role=alert]')?.textContent).toBe('Access denied');
    expect(hosted.textContent).toContain('Hosted content');
  });

  it('groups continuous setting rows into one inset list with divider-owned children', () => {
    const host = mount(() => (
      <SettingsList>
        <SettingRow title="First" description="First description" />
        <SettingRow title="Second" description="Second description" />
      </SettingsList>
    ));

    const list = host.querySelector('.redeven-settings-list');
    expect(list).not.toBeNull();
    expect(list?.querySelectorAll(':scope > .redeven-setting-row')).toHaveLength(2);
    expect(list?.querySelector('.redeven-surface-panel')).toBeNull();
  });

  it('does not reserve an empty category header for empty feedback', () => {
    const host = mount(() => {
      const session = createSettingsSession();
      return <SettingsPanelContext.Provider value={{ ...session, register: () => () => {} }}>
        <SettingsSection variant="page" title="Connection" feedback={[]}><input aria-label="Address" /></SettingsSection>
      </SettingsPanelContext.Provider>;
    });
    expect(host.querySelector('.floe-settings-section__header')).toBeNull();
    expect(host.querySelector('input')?.getAttribute('aria-label')).toBe('Address');
  });

  it('keeps table rows transparent by default and opts into selected or interactive states explicitly', () => {
    const host = mount(() => (
      <SettingsTable>
        <SettingsTableHead>
          <SettingsTableHeaderRow>
            <SettingsTableHeaderCell>Setting</SettingsTableHeaderCell>
          </SettingsTableHeaderRow>
        </SettingsTableHead>
        <SettingsTableBody>
          <SettingsTableRow><SettingsTableCell>Static</SettingsTableCell></SettingsTableRow>
          <SettingsTableRow selected interactive><SettingsTableCell>Selected</SettingsTableCell></SettingsTableRow>
        </SettingsTableBody>
      </SettingsTable>
    ));

    const rows = host.querySelectorAll('.redeven-settings-table__row');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.classList.contains('redeven-settings-table__row--interactive')).toBe(false);
    expect(rows[1]?.classList.contains('redeven-settings-table__row--selected')).toBe(true);
    expect(rows[1]?.classList.contains('redeven-settings-table__row--interactive')).toBe(true);
    expect(host.querySelector('.redeven-surface-panel')).toBeNull();
  });
});
