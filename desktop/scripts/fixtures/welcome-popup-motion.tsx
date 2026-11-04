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
import { ManualModelCapabilities } from '../../../internal/flower_ui/src/settings/ManualModelCapabilities';
import { FlowerProviderDialog } from '../../../internal/flower_ui/src/settings/FlowerProviderDialog';
import type { FlowerProviderModel } from '../../../internal/flower_ui/src/contracts/flowerSurfaceContracts';
import { modelCatalogCopy } from '../../../internal/flower_ui/src/settings/modelCatalogCopy';
import { FlowerContextCompactionDivider } from '../../../internal/flower_ui/src/chat/FlowerContextCompactionDivider';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../internal/flower_ui/src/copy';
import { SpreadsheetPreview } from '../../../internal/flower_ui/src/preview/SpreadsheetPreview';
import { taskFilesEnUS } from '../../../internal/flower_ui/src/taskFilesCopy';
import { FlowerComputerStage } from '../../../internal/flower_ui/src/FlowerComputerStage';
import { FlowerTurnLauncherWindow } from '../../../internal/flower_ui/src/FlowerTurnLauncherWindow';
import { FlowerWorkingDirPickerDialog } from '../../../internal/flower_ui/src/filePicker/FlowerWorkingDirPickerDialog';
import '../../src/welcome/index.css';

const [open, setOpen] = createSignal(false);
const [kind, setKind] = createSignal('action');
const [side, setSide] = createSignal<DesktopOverlayPlacement>('top');
const [placement, setPlacement] = createSignal({ left: 150, top: 450 });
const [exits, setExits] = createSignal(0);
const [frameRate, setFrameRate] = createSignal(3);
const [windowCloses, setWindowCloses] = createSignal(0);
const [capabilityModel, setCapabilityModel] = createSignal<FlowerProviderModel>({ model_name: 'fixture' });
const i18n = createDesktopI18n('en-US');
const previewBytes = new TextEncoder().encode('name,value\nFixture,1');
let anchor: HTMLButtonElement | undefined;
const theme = { source: 'dark' as const, resolvedTheme: 'dark' as const, shellThemes: { light: 'porcelain-light', dark: 'porcelain-dark' } };
const content = () => <div style={{ padding: '16px', width: 'min(280px, calc(100vw - 16px))' }}><h2>Environment runtime</h2><label>Draft<input aria-label="Draft" /></label><button onClick={() => setOpen(false)}>Close popup</button></div>;
Object.assign(window, { popupFixture: { setOpen, setKind, setSide, setPlacement, exits, windowCloses, capabilityModel } });
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
    <Show when={kind() === 'capabilities'}><ManualModelCapabilities model={capabilityModel()} type="openai_compatible" baseURL="https://example.invalid/v1" copy={modelCatalogCopy('en-US')} onChange={patch => setCapabilityModel(model => ({ ...model, ...patch }))} /></Show>
    <Show when={kind() === 'kimi-endpoint'}><FlowerProviderDialog open mode="edit" provider={{ id: 'fixture-kimi', type: 'kimi_code', base_url: 'https://api.kimi.com/coding/v1', models: [{ model_name: 'kimi-for-coding' }] }}
      keyConfigured webSearchKeyConfigured={false} onOpenChange={() => {}} onConfirm={() => {}} /></Show>
    <Show when={kind() === 'directory'}><button id="anchor" onClick={() => setOpen(!open())}>Working directory</button><FlowerWorkingDirPickerDialog open={open()} onOpenChange={setOpen} onSelect={() => {}} /></Show>
    <Show when={kind() === 'launcher'}><button id="anchor" onClick={() => setOpen(!open())}>Ask Flower</button><FlowerTurnLauncherWindow open={open()} intent={open() ? { id: 'motion-fixture', source_surface: 'file_preview', initial_prompt: 'Retained question', context_items: [], notes: [] } : null} onClose={() => setOpen(false)} onSubmit={async () => {}} /></Show>
    <Show when={kind() === 'preview-select' || kind() === 'preview-panel'}><div style={{ width: 'min(600px, calc(100vw - 66px))', height: '250px' }}><SpreadsheetPreview bytes={previewBytes} format={kind() === 'preview-panel' ? 'xlsx' : 'csv'} copy={taskFilesEnUS} /></div></Show>
    <Show when={kind() === 'compaction'}><FlowerContextCompactionDivider copy={DEFAULT_FLOWER_SURFACE_COPY} decoration={{
      decoration_id: 'fixture', kind: 'context_compaction', ordinal: 1, anchor: { target_kind: 'message', message_id: 'fixture', edge: 'after' },
      compaction: { operation_id: 'fixture', turn_id: 'fixture', canonical_ordinal: 1, phase: 'complete', status: 'compacted', updated_at_ms: 1, tokens_before: 60000, tokens_after_estimate: 488 },
    }} /></Show>
    <Show when={kind() === 'frame-rate'}><FlowerComputerStage open sessionState="completed" frameRate={frameRate()} onFrameRateChange={setFrameRate} onRestore={() => {}} onClose={() => setWindowCloses(count => count + 1)}
      snapshot={{ item: { item_id: 'fixture', kind: 'tool', status: 'success', severity: 'normal', needs_attention: false, requires_approval: false }, target: 'Fixture computer', action: 'observe', status: 'success' }}
      copy={{ title: 'Computer', close: 'Close', maximize: 'Maximize', restoreSize: 'Restore size', zoomIn: 'Actual size', zoomOut: 'Fit', restore: 'Restore', move: 'Move', noFrame: 'No frame', loading: 'Loading', retry: 'Retry', resumeControl: 'Resume', frameRate: 'Frame rate', frameRateHint: 'Requested rate', receivedFrameRate: 'Received {fps} FPS', state: DEFAULT_FLOWER_SURFACE_COPY.chat.computerStageStatus }} />
    </Show>
  </div>
</main></FloeProvider>, document.getElementById('root')!);
