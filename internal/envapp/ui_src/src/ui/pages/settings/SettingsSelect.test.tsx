// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import type { SelectProps } from '@floegence/floe-webapp-core/ui';
import { SettingsPanelContext } from '../../../../../../settings_ui/src/SettingsPanelHost';
import { createSettingsSession } from '../../../../../../settings_ui/src/settingsSession';
import { SettingsSelect } from './SettingsSelect';

const state = vi.hoisted(() => ({ control: undefined as SelectProps | undefined }));
vi.mock('@floegence/floe-webapp-core/ui', () => ({ Select: (props: SelectProps) => {
  state.control = props;
  return <button disabled={props.disabled} aria-expanded={props.open} onClick={() => props.onOpenChange?.(!props.open)}>Choose</button>;
} }));
let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => { dispose?.(); host.remove(); });
function mount(exact = false) {
  host = document.createElement('div'); document.body.append(host);
  let session!: ReturnType<typeof createSettingsSession>, setActive!: (value: boolean) => void;
  const change = vi.fn(), select = vi.fn(), query = vi.fn(), retry = vi.fn();
  dispose = render(() => {
    session = createSettingsSession(); session.open({ section: 'containers', resource: 'docker-a' }); session.setPresent(true);
    const [active, updateActive] = createSignal(true); setActive = updateActive;
    return <SettingsPanelContext.Provider value={{ ...session, register: () => () => {} }}>
      <SettingsSelect section="containers" resource={exact ? 'docker-a' : undefined} active={active()} value="one" options={[{ value: 'one', label: 'One' }]}
        onChange={change} onOptionSelect={select} onQueryChange={query} onRetry={retry} />
    </SettingsPanelContext.Provider>;
  }, host);
  return { session, setActive, change, select, query, retry };
}
function choose() {
  state.control!.onChange?.('one'); state.control!.onOptionSelect?.({ value: 'one', label: 'One' });
  state.control!.onQueryChange?.('search'); state.control!.onRetry?.();
}

it('retires popup and callbacks when a retained category hides without replay on return', () => {
  const { session, change, select, query, retry } = mount();
  host.querySelector('button')!.click(); expect(state.control!.open).toBe(true);
  session.open({ section: 'appearance' });
  expect(state.control!.open).toBe(false); expect(state.control!.disabled).toBe(true);
  choose(); for (const callback of [change, select, query, retry]) expect(callback).not.toHaveBeenCalled();
  session.open({ section: 'containers', resource: 'docker-a' });
  expect(state.control!.open).toBe(false); expect(state.control!.disabled).toBe(false);
  choose(); for (const callback of [change, select, query, retry]) expect(callback).toHaveBeenCalledOnce();
});
it('keeps a category selector available across resources while exact editor controls retire', () => {
  const category = mount(); category.session.open({ section: 'containers', resource: 'docker-b' });
  choose(); expect(category.change).toHaveBeenCalledOnce();
  dispose?.(); host.remove();
  const editor = mount(true); editor.session.open({ section: 'containers', resource: 'docker-b' });
  choose(); expect(editor.change).not.toHaveBeenCalled(); expect(state.control!.disabled).toBe(true);
});
it('closes on host dismissal and rejects owner-disabled choices', () => {
  const { session, setActive, change } = mount();
  host.querySelector('button')!.click(); session.setPresent(false);
  expect(state.control!.open).toBe(false); choose(); expect(change).not.toHaveBeenCalled();
  session.setPresent(true); setActive(false); choose(); expect(change).not.toHaveBeenCalled();
  state.control!.onOpenChange?.(true); expect(state.control!.open).toBe(false);
});
