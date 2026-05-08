// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvContext } from '../pages/EnvContext';
import { EnvWorkbenchInstancesContext } from './EnvWorkbenchInstancesContext';
import { WorkbenchFilePreviewWidget } from './WorkbenchFilePreviewWidget';
import type { RuntimeWorkbenchPreviewItem } from './runtimeWorkbenchLayout';

const controllerStore = vi.hoisted(() => ({
  item: null as null | (() => any),
  setItem: null as null | ((item: any) => void),
  dirty: null as null | (() => boolean),
  setDirty: null as null | ((dirty: boolean) => void),
  openPreview: vi.fn(async (item: any) => {
    controllerStore.setItem?.(item);
    controllerStore.setDirty?.(false);
  }),
  handleOpenChange: vi.fn(),
  cancelPendingAction: vi.fn(),
  confirmDiscardAndContinue: vi.fn(async () => undefined),
  beginEditing: vi.fn(),
  updateDraft: vi.fn(),
  updateSelection: vi.fn(),
  saveCurrent: vi.fn(async () => true),
  revertCurrent: vi.fn(),
  downloadCurrent: vi.fn(async () => undefined),
}));

const workbenchStore = vi.hoisted(() => ({
  updatePreviewItem: vi.fn(),
  setPendingSyncedPreviewItem: vi.fn(),
  registerWidgetRemoveGuard: vi.fn(),
  consumePreviewOpenRequest: vi.fn(),
  removeWidget: vi.fn(),
}));

vi.mock('@floegence/floe-webapp-core', () => ({
  useNotification: () => ({
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({
    client: () => ({ id: 'client' }),
  }),
}));

vi.mock('../protocol/redeven_v1', () => ({
  useRedevenRpc: () => ({}),
}));

vi.mock('../utils/clipboard', () => ({
  writeTextToClipboard: vi.fn(async () => undefined),
}));

vi.mock('../utils/filePreviewAskFlower', () => ({
  buildFilePreviewAskFlowerIntent: () => ({}),
}));

vi.mock('../widgets/FilePreviewPanel', () => ({
  FilePreviewPanel: () => <div data-testid="file-preview-panel" />,
}));

vi.mock('../widgets/createFilePreviewController', () => ({
  createFilePreviewController: () => ({
    open: () => true,
    item: () => controllerStore.item?.() ?? null,
    descriptor: () => ({ mode: 'text' }),
    text: () => 'local draft',
    draftText: () => 'local draft',
    editing: () => true,
    dirty: () => controllerStore.dirty?.() ?? false,
    saving: () => false,
    saveError: () => null,
    canEdit: () => true,
    selectedText: () => '',
    closeConfirmOpen: () => false,
    closeConfirmMessage: () => '',
    message: () => '',
    objectUrl: () => '',
    bytes: () => null,
    truncated: () => false,
    loading: () => false,
    error: () => null,
    xlsxSheetName: () => '',
    xlsxRows: () => [],
    downloadLoading: () => false,
    openPreview: controllerStore.openPreview,
    closePreview: vi.fn(),
    handleOpenChange: controllerStore.handleOpenChange,
    cancelPendingAction: controllerStore.cancelPendingAction,
    confirmDiscardAndContinue: controllerStore.confirmDiscardAndContinue,
    beginEditing: controllerStore.beginEditing,
    updateDraft: controllerStore.updateDraft,
    updateSelection: controllerStore.updateSelection,
    saveCurrent: controllerStore.saveCurrent,
    revertCurrent: controllerStore.revertCurrent,
    downloadCurrent: controllerStore.downloadCurrent,
  }),
}));

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

function renderPreviewWidget() {
  const [controllerItem, setControllerItem] = createSignal<any>({
    id: '/workspace/local.ts',
    type: 'file',
    path: '/workspace/local.ts',
    name: 'local.ts',
  });
  const [dirty, setDirty] = createSignal(true);
  const [sharedItem, setSharedItem] = createSignal<RuntimeWorkbenchPreviewItem | null>(null);
  const [pendingItem, setPendingItem] = createSignal<RuntimeWorkbenchPreviewItem | null>(null);
  const [openRequest, setOpenRequest] = createSignal<any>(null);
  const host = document.createElement('div');
  document.body.appendChild(host);

  controllerStore.item = controllerItem;
  controllerStore.setItem = setControllerItem;
  controllerStore.dirty = dirty;
  controllerStore.setDirty = setDirty;
  workbenchStore.setPendingSyncedPreviewItem.mockImplementation((_widgetId: string, item: RuntimeWorkbenchPreviewItem | null) => {
    setPendingItem(item);
  });

  const dispose = render(() => (
    <EnvContext.Provider
      value={{
        env: () => ({ permissions: { can_write: true } }),
        openAskFlowerComposer: vi.fn(),
      } as any}
    >
      <EnvWorkbenchInstancesContext.Provider
        value={{
          latestWidgetIdByType: () => ({}),
          markLatestWidget: vi.fn(),
          terminalPanelState: () => ({ sessionIds: [], activeSessionId: null }),
          terminalGeometryPreferences: () => ({ fontSize: 12, fontFamilyId: 'monaco' }),
          updateTerminalGeometryPreferences: vi.fn(),
          updateTerminalPanelState: vi.fn(),
          createTerminalSession: vi.fn(async () => null),
          deleteTerminalSession: vi.fn(async () => undefined),
          registerTerminalCore: vi.fn(),
          registerTerminalSurface: vi.fn(),
          terminalOpenRequest: () => null,
          dispatchTerminalOpenRequest: vi.fn(),
          consumeTerminalOpenRequest: vi.fn(),
          fileBrowserOpenRequest: () => null,
          dispatchFileBrowserOpenRequest: vi.fn(),
          consumeFileBrowserOpenRequest: vi.fn(),
          updateFileBrowserPath: vi.fn(),
          previewItem: () => sharedItem(),
          pendingSyncedPreviewItem: () => pendingItem(),
          setPendingSyncedPreviewItem: workbenchStore.setPendingSyncedPreviewItem,
          updatePreviewItem: workbenchStore.updatePreviewItem,
          previewOpenRequest: () => openRequest(),
          dispatchPreviewOpenRequest: vi.fn(),
          consumePreviewOpenRequest: workbenchStore.consumePreviewOpenRequest,
          registerWidgetRemoveGuard: workbenchStore.registerWidgetRemoveGuard,
          removeWidget: workbenchStore.removeWidget,
          requestWidgetRemoval: vi.fn(),
          updateWidgetTitle: vi.fn(),
        }}
      >
        <WorkbenchFilePreviewWidget widgetId="widget-preview-1" title="Preview" type="redeven.preview" />
      </EnvWorkbenchInstancesContext.Provider>
    </EnvContext.Provider>
  ), host);

  return {
    host,
    dispose,
    setSharedItem,
    setDirty,
    setOpenRequest,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('WorkbenchFilePreviewWidget', () => {
  it('prompts instead of replacing a dirty preview when a synced file changes remotely', async () => {
    const harness = renderPreviewWidget();

    try {
      await flush();
      controllerStore.openPreview.mockClear();

      harness.setSharedItem({
        id: '/workspace/remote.ts',
        type: 'file',
        path: '/workspace/remote.ts',
        name: 'remote.ts',
      });
      await flush();

      expect(harness.host.textContent).toContain('Synced preview pending');
      expect(harness.host.textContent).toContain('remote.ts');
      expect(controllerStore.openPreview).not.toHaveBeenCalled();

      Array.from(harness.host.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Keep current draft'))
        ?.click();
      await flush();

      expect(harness.host.textContent).not.toContain('Synced preview pending');
      expect(controllerStore.openPreview).not.toHaveBeenCalled();
    } finally {
      harness.dispose();
    }
  });

  it('opens a pending synced preview only after explicit user confirmation', async () => {
    const harness = renderPreviewWidget();
    const remoteItem: RuntimeWorkbenchPreviewItem = {
      id: '/workspace/remote.ts',
      type: 'file',
      path: '/workspace/remote.ts',
      name: 'remote.ts',
    };

    try {
      await flush();
      controllerStore.openPreview.mockClear();

      harness.setSharedItem(remoteItem);
      await flush();

      Array.from(harness.host.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Open synced file'))
        ?.click();
      await flush();

      expect(controllerStore.openPreview).toHaveBeenCalledWith(remoteItem);
      expect(harness.host.textContent).not.toContain('Synced preview pending');
    } finally {
      harness.dispose();
    }
  });

  it('does not treat a dirty blocked open request as hydrated', async () => {
    const harness = renderPreviewWidget();
    const blockedItem: RuntimeWorkbenchPreviewItem = {
      id: '/workspace/blocked.ts',
      type: 'file',
      path: '/workspace/blocked.ts',
      name: 'blocked.ts',
    };

    try {
      await flush();
      controllerStore.openPreview.mockClear();

      controllerStore.openPreview.mockImplementationOnce(async () => undefined);
      harness.setOpenRequest({
        requestId: 'request-blocked-preview',
        widgetId: 'widget-preview-1',
        item: blockedItem,
      });
      await flush();

      expect(workbenchStore.consumePreviewOpenRequest).toHaveBeenCalledWith('request-blocked-preview');
      expect(controllerStore.openPreview).toHaveBeenCalledWith(blockedItem);
      expect(controllerStore.item?.()?.path).toBe('/workspace/local.ts');

      harness.setSharedItem(blockedItem);
      await flush();

      expect(harness.host.textContent).toContain('Synced preview pending');
      expect(harness.host.textContent).toContain('blocked.ts');
    } finally {
      harness.dispose();
    }
  });

  it('does not reopen the same clean preview through shared state while a direct open request is in flight', async () => {
    const harness = renderPreviewWidget();
    const targetItem: RuntimeWorkbenchPreviewItem = {
      id: '/workspace/target.ts',
      type: 'file',
      path: '/workspace/target.ts',
      name: 'target.ts',
    };

    try {
      await flush();
      harness.setDirty(false);
      controllerStore.openPreview.mockClear();

      let resolveOpen: () => void = () => {
        throw new Error('open promise was not created');
      };
      controllerStore.openPreview.mockImplementationOnce((async (item: any) => {
        await new Promise<void>((resolve) => {
          resolveOpen = resolve;
        });
        controllerStore.setItem?.(item);
        controllerStore.setDirty?.(false);
      }) as any);

      harness.setOpenRequest({
        requestId: 'request-target-preview',
        widgetId: 'widget-preview-1',
        item: targetItem,
      });
      await flush();
      harness.setSharedItem(targetItem);
      await flush();

      expect(controllerStore.openPreview).toHaveBeenCalledTimes(1);
      expect(controllerStore.openPreview).toHaveBeenCalledWith(targetItem);

      resolveOpen();
      await flush();

      expect(controllerStore.openPreview).toHaveBeenCalledTimes(1);
      expect(controllerStore.item?.()?.path).toBe('/workspace/target.ts');
    } finally {
      harness.dispose();
    }
  });
});
