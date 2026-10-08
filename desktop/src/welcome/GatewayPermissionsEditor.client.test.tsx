import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { GatewayPermissionsEditor } from './GatewayPermissionsEditor';
import { createDesktopI18n } from '../shared/i18n';
import type { GatewayPermissions } from '../shared/gatewayMembership';
import { controlText } from '../testSupport/controlText';

const i18n = createDesktopI18n('en-US');
let dispose: (() => void) | undefined;
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
function mount(permissions: GatewayPermissions, disabled = false) {
  const root = document.createElement('div'); document.body.append(root);
  const [value, setValue] = createSignal(permissions);
  const changed = vi.fn((next: GatewayPermissions) => setValue(next));
  dispose = render(() => <GatewayPermissionsEditor i18n={i18n} value={value()} disabled={disabled} onChange={changed} />, root);
  return changed;
}
async function choose(label: string) {
  (document.querySelector('[data-floe-dropdown-trigger]') as HTMLElement).click(); await settle();
  const option = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(element => controlText(element) === label);
  expect(option).toBeTruthy(); option!.click(); await settle();
}
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('Desktop access to a Gateway', () => {
  it('names the Desktop as permission recipient and keeps administrator details collapsed without changing grants', async () => {
    const changed = mount({ access: true, manage_members: true, configure_cloud: true }); await settle();
    expect(document.querySelector('legend')?.textContent).toBe(i18n.t('gatewayDesktopAccess.title'));
    expect(document.querySelector('[role="button"]')?.textContent).toContain(i18n.t('gatewayDesktopAccess.administrator'));
    expect(document.querySelector('details')?.open).toBe(false);
    expect(changed).not.toHaveBeenCalled();
  });
  it('changes all three scopes only after an explicit role choice', async () => {
    const changed = mount({ access: true, manage_members: false, configure_cloud: false }); await settle();
    await choose(i18n.t('gatewayDesktopAccess.administrator'));
    expect(changed).toHaveBeenLastCalledWith({ access: true, manage_members: true, configure_cloud: true });
    await choose(i18n.t('gatewayDesktopAccess.viewer'));
    expect(changed).toHaveBeenLastCalledWith({ access: true, manage_members: false, configure_cloud: false });
  });
  it('keeps the custom choice visible without changing permissions just to inspect them', async () => {
    const changed = mount({ access: true, manage_members: false, configure_cloud: false }); await settle();
    await choose(i18n.t('gatewayDesktopAccess.custom'));
    expect(document.querySelector('[role="button"]')?.textContent).toContain(i18n.t('gatewayDesktopAccess.custom'));
    expect(document.querySelector('details')?.open).toBe(true);
    expect(changed).not.toHaveBeenCalled();
  });
  it('preserves independent existing grants and makes custom scope edits explicit', async () => {
    const changed = mount({ access: false, manage_members: true, configure_cloud: false }); await settle();
    expect(document.querySelector('details')?.open).toBe(true);
    expect(changed).not.toHaveBeenCalled();
    const checkbox = document.querySelector<HTMLElement>('[role="checkbox"], input[type="checkbox"]')!;
    checkbox.click(); await settle();
    expect(changed).toHaveBeenLastCalledWith({ access: true, manage_members: true, configure_cloud: false });
    expect(document.body.textContent).toContain(i18n.t('gatewayDesktopAccess.boundary'));
  });
  it('prevents permission changes while saving', async () => {
    const changed = mount({ access: true, manage_members: false, configure_cloud: false }, true); await settle();
    expect(document.querySelector('[role="button"]')?.getAttribute('aria-disabled')).toBe('true');
    expect(changed).not.toHaveBeenCalled();
  });
});
