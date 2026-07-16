// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import {
  SettingRow,
  SettingsList,
  SettingsSection,
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

  it('keeps the section as the only elevated settings container', () => {
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
    expect(section).not.toBeNull();
    expect(section?.classList.contains('border')).toBe(true);
    expect(section?.classList.contains('shadow-sm')).toBe(false);
    expect(section?.querySelector('.redeven-surface-panel')).toBeNull();
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
