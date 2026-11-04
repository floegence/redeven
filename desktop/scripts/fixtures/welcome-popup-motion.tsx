import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { Dropdown, Select } from '@floegence/floe-webapp-core/ui';
import { DesktopActionPopover } from '../../src/welcome/DesktopActionPopover';
import { DesktopAnchoredOverlaySurface } from '../../src/welcome/DesktopAnchoredOverlaySurface';
import { DesktopAnchoredListbox } from '../../src/welcome/DesktopAnchoredListbox';
import { DesktopPopover } from '../../src/welcome/DesktopPopover';
import { DesktopTooltip } from '../../src/welcome/DesktopTooltip';
import { DesktopThemePicker } from '../../src/welcome/DesktopThemePicker';
import { EndpointsPopover } from '../../src/welcome/App';
import { SSHDestinationCombobox } from '../../src/welcome/SSHDestinationCombobox';
import { createDesktopI18n } from '../../src/shared/i18n';
import type { DesktopOverlayPlacement } from '../../src/welcome/desktopOverlayPosition';
import { FlowerThreadList } from '../../../internal/flower_ui/src/threads/FlowerThreadList';
import '../../src/welcome/index.css';

const [open, setOpen] = createSignal(false);
const [kind, setKind] = createSignal('action');
const [side, setSide] = createSignal<DesktopOverlayPlacement>('top');
const [placement, setPlacement] = createSignal({ left: 150, top: 450 });
const [exits, setExits] = createSignal(0);
const i18n = createDesktopI18n('en-US');
let anchor: HTMLButtonElement | undefined;
const theme = { source: 'dark' as const, resolvedTheme: 'dark' as const, shellThemes: { light: 'porcelain-light', dark: 'porcelain-dark' } };
const content = () => <div style={{ padding: '16px', width: 'min(280px, calc(100vw - 16px))' }}><h2>Environment runtime</h2><label>Draft<input aria-label="Draft" /></label><button onClick={() => setOpen(false)}>Close popup</button></div>;
Object.assign(window, { popupFixture: { setOpen, setKind, setSide, setPlacement, exits } });
document.documentElement.style.setProperty('--redeven-desktop-titlebar-height', '40px');
render(() => <FloeProvider><main style={{ padding: '50px' }}>
  <button id="outside">Outside</button>
  <div style={{ position: 'fixed', left: `${placement().left}px`, top: `${placement().top}px` }}>
    <Show when={kind() === 'surface'}><button id="anchor" ref={anchor} onClick={() => setOpen(!open())}>Actions</button><DesktopAnchoredOverlaySurface open={open()} anchorRef={anchor} placement={side()} interactive={open()} onExitComplete={() => setExits(n => n + 1)} role="dialog" class="rounded-panel border border-border bg-popover">{content()}</DesktopAnchoredOverlaySurface></Show>
    <Show when={kind() === 'action'}><DesktopActionPopover open={open()} onOpenChange={setOpen} onExitComplete={() => setExits(n => n + 1)} content={content()}><button id="anchor" onClick={() => setOpen(!open())}>Runtime progress</button></DesktopActionPopover></Show>
    <Show when={kind() === 'hover'}><DesktopPopover open={open()} onOpenChange={setOpen} content={content()} delay={0} closeDelay={0}><button id="anchor">Details</button></DesktopPopover></Show>
    <Show when={kind() === 'tooltip'}><DesktopTooltip content="Runtime details" delay={0}><button id="anchor">Help</button></DesktopTooltip></Show>
    <Show when={kind() === 'listbox'}><button id="anchor" ref={anchor} onClick={() => setOpen(!open())}>Language</button><DesktopAnchoredListbox anchorRef={anchor} open={open()} width={280} role="listbox"><button role="option">English</button><button role="option" onClick={() => setOpen(false)}>简体中文</button></DesktopAnchoredListbox></Show>
    <Show when={kind() === 'endpoints'}><EndpointsPopover i18n={i18n} endpoints={[]} environmentID="fixture" environmentLabel="Fixture environment" open={open()} onOpenChange={setOpen} openInBrowser={async () => {}} copyEnvironmentValue={async () => {}} selectEndpointForQRCode={() => {}} /></Show>
    <Show when={kind() === 'theme'}><DesktopThemePicker i18n={i18n} openRequest={0} snapshot={theme} onSourceChange={() => theme} onShellThemeChange={() => theme} /></Show>
    <Show when={kind() === 'ssh'}><SSHDestinationCombobox i18n={i18n} value="" onInput={() => {}} inputID="ssh-fixture" loading={false} loadError={false} autofocus={false} onSelectHost={() => setOpen(false)} onRetry={() => {}} hosts={[{ alias: 'fixture', host_name: '192.0.2.1', user: 'user', port: 22, source_path: '~/.ssh/config' }]} /></Show>
    <Show when={kind() === 'dropdown'}><Dropdown trigger="Gateway actions" onSelect={() => {}} items={[{ id: 'refresh', label: 'Refresh' }, { id: 'settings', label: 'Settings' }]} /></Show>
    <Show when={kind() === 'flower-context'}><div style={{ width: '280px' }}><FlowerThreadList
      items={[{ thread_id: 'fixture-thread', title: 'Fixture conversation', title_status: 'ready', model_id: 'default/model', working_dir: '/workspace', pinned: false,
        created_at_ms: 1, updated_at_ms: 1, preview: '', status: 'idle', source_label: 'this host', target_labels: [],
        read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } } }]}
      query="" onQueryChange={() => {}} onSelect={() => {}} onRefresh={() => {}} onMenuAction={() => {}} />
    </div></Show>
    <Show when={kind() === 'select'}><Select value="one" onChange={() => {}} options={[{ value: 'one', label: 'Saved gateway' }, { value: 'two', label: 'Other gateway' }]} /></Show>
  </div>
</main></FloeProvider>, document.getElementById('root')!);
