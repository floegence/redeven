import '../index.css';
import './flower-feature.css';
import { FloeConfigProvider, FloeProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { expect, it, onTestFinished, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { EnvAppThemePicker } from './EnvAppThemePicker';
import { WindowModal } from './widgets/WindowModal';
import { InputDialog } from './widgets/InputDialog';
import { TerminalGroupEditorDialog, TerminalGroupDeleteDialog } from './widgets/TerminalGroupDialogs';
import { FileBrowserRecoveryView } from './widgets/FileBrowserRecoveryView';
import { ArchiveExtractionDialog } from './widgets/ArchiveExtractionDialog';
import { ExternalPluginInstallDialog } from './plugins/ExternalPluginInstallDialog';
import { PluginUpdateReviewDialog } from './plugins/PluginUpdateReviewDialog';
import { PluginCenterView } from './plugins/PluginCenterView';
import { EnvironmentAccessGate } from './EnvironmentAccessGate';
import { FlowerSettingsSurface } from '../../../../flower_ui/src/settings/FlowerSettingsSurface';
import { FlowerManagedBrowser } from '../../../../flower_ui/src/FlowerManagedBrowser';
import { computerUseEnUS } from '../../../../flower_ui/src/computerUseCopy';

const noop = () => undefined;
const resolved = vi.fn().mockResolvedValue(undefined);
const media = commands as unknown as { emulateTouchInput: (value: boolean) => Promise<void> };
async function mount(component: () => JSX.Element, touch = false, width = 1100) {
  await page.viewport(width, 900);
  await media.emulateTouchInput(touch);
  const host = document.createElement('div');
  host.style.cssText = 'height:850px;width:100%;position:relative';
  document.body.append(host);
  const dispose = render(() => <FloeConfigProvider><LayoutProvider>{component()}</LayoutProvider></FloeConfigProvider>, host);
  onTestFinished(async () => { dispose(); host.remove(); await media.emulateTouchInput(false); });
  await document.fonts.ready;
  return host;
}
async function expectSize(selector: string, size = '12px') {
  await expect.poll(() => document.querySelector(selector)).not.toBeNull();
  await document.fonts.ready;
  for (const element of document.querySelectorAll(selector)) {
    expect.soft(getComputedStyle(element).fontSize, `${selector}: ${element.textContent?.slice(0, 80)}`).toBe(size);
  }
}
it('uses the body role for local window guidance and preserves the title role', async () => {
  await mount(() => {
    const [host, setHost] = createSignal<HTMLElement>();
    return <div ref={setHost} style={{ height: '100%' }}><WindowModal open host={host()} title="File access" bodyDescription="Allow access to this directory." /></div>;
  });
  await expectSize('[role="dialog"] p');
  await expectSize('[role="dialog"] [id]:not(p)', '14px');
});
it.each([false, true])('keeps rename editing usable, touch=%s', async touch => {
  const confirm = vi.fn();
  await mount(() => <InputDialog open title="Rename" label="Name" value="notes.md" onConfirm={confirm} onCancel={noop} />, touch, 390);
  await expectSize('[role="dialog"] input', touch ? '16px' : '12px');
  const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
  input.value = 'renamed.md'; input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(confirm).toHaveBeenCalledWith('renamed.md');
  if (touch) expect(input.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
});
it('keeps terminal group fields at the control scale', async () => {
  await mount(() => <TerminalGroupEditorDialog open group={null} defaultWorkingDir="/workspace/project" onCancel={noop} onSubmit={noop} />);
  await expectSize('[role="dialog"] input');
});
it('keeps terminal deletion guidance at the body scale', async () => {
  await mount(() => <TerminalGroupDeleteDialog open group={null} sessionCount={3} onCancel={noop} onConfirm={noop} />);
  await expectSize('[role="dialog"] p');
});
it('keeps folder guidance compact without shrinking the heading', async () => {
  await mount(() => <FileBrowserRecoveryView requestedPath="/workspace/project" message="Check the folder access settings." unavailable pending={false} homeAvailable parentAvailable accessFailure canManageAccess onRetry={noop} onOpenHome={noop} onOpenParent={noop} onManageAccess={noop} onDismiss={noop} />);
  await expectSize('[role="status"] p:last-child');
  expect(parseFloat(getComputedStyle(document.querySelector('h2')!).fontSize)).toBeGreaterThan(12);
});
it('keeps archive warnings and inputs compact', async () => {
  await mount(() => <ArchiveExtractionDialog open request={{ item: { id: 'archive', name: 'project.zip', path: '/workspace/project.zip', type: 'file' }, classification: { kind: 'multipart', format: 'zip', defaultOutputName: 'project' } }} pickerProps={{ loadDirectory: vi.fn().mockResolvedValue([]) }} isWritablePath={() => true} onExtract={resolved} onComplete={noop} onClose={noop} />);
  await expectSize('[data-testid="archive-extraction-dialog"] [role="alert"]');
  await expectSize('[data-testid="archive-extraction-dialog"] input:not([type="checkbox"])');
});
it.each([false, true])('keeps plugin source fields and actions on their roles, touch=%s', async touch => {
  await mount(() => <ExternalPluginInstallDialog open onOpenChange={noop} onInspect={resolved} onCommit={resolved} onCommitted={noop} />, touch);
  await expectSize('[data-external-plugin-source-input]', touch ? '16px' : '12px');
  await expectSize('[data-external-plugin-inspect]', touch ? '13px' : '12px');
  if (touch) expect(document.querySelector('[data-external-plugin-inspect]')!.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
});
it('keeps plugin update status at the body scale', async () => {
  await mount(() => <PluginUpdateReviewDialog open canManage onOpenChange={noop} onInspect={resolved} onCommitExternal={resolved} onOfficialUpdate={resolved} onRefresh={resolved} onCommitted={noop} onOpenSurface={noop} onViewPermissions={noop} />);
  await expectSize('[data-plugin-update-dialog] [role="status"]');
});
it.each([false, true])('separates narrow Plugin Center search from touch, touch=%s', async touch => {
  await mount(() => <PluginCenterView projection={{ items: [] }} loading={false} canManagePlugins canOpenPluginSurfaces onRefresh={resolved} onCommand={resolved} />, touch, 390);
  await expectSize('[data-plugin-center-search]', touch ? '16px' : '12px');
});
it.each([false, true])('separates narrow access fields from touch, touch=%s', async touch => {
  await mount(() => <EnvironmentAccessGate phase="unlock_required" local environmentName="Local environment" pending={false} unlocking={false} recoveryBusy={false} retryActive={false} retryDuration="" password="" feedback={null} languageMenu={null} inputRef={noop} onPasswordInput={noop} onSubmit={resolved} onRetry={resolved} onReload={noop} />, touch, 390);
  await expectSize('#redeven-access-password', touch ? '16px' : '12px');
  await expectSize('label[for="redeven-access-password"]', touch ? '13px' : '12px');
});
it('keeps the Flower computer-use switch on the control scale', async () => {
  await mount(() => <FlowerSettingsSurface snapshot={{ defaults: { permission_type: 'approval_required', computer_use_enabled: true }, model_profile: { schema_version: 1, current_model_id: '', providers: [] }, provider_secrets: [] }} onSaveDefaultPermission={resolved} onSaveComputerUseEnabled={resolved} onSaveModelProfile={resolved} />);
  await expectSize('.flower-settings-toggle-label');
});
it('keeps managed-browser readiness on the body scale', async () => {
  await mount(() => <FlowerManagedBrowser copy={computerUseEnUS} canMutate management={{ loadBrowserInstallation: vi.fn().mockResolvedValue({ enabled: true, state: 'installed', launch: { state: 'ready' }, package: { name: 'Chromium', version: '153', platform: 'darwin', architecture: 'arm64' } }) }} />);
  await expectSize('.flower-browser-ready p');
});

it('keeps inline appearance choices at the control scale', async () => {
  await mount(() => <FloeProvider config={{ storage: { enabled: false } }}><EnvAppThemePicker presentation="inline" onSourceChange={() => true} onShellThemeChange={() => true} /></FloeProvider>);
  await expectSize('[role="radio"]');
});
