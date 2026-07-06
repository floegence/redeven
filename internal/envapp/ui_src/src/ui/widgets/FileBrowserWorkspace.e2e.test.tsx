// @vitest-environment jsdom

import { FileBrowserDragProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import type { ContextMenuEvent, ContextMenuItem, FileBrowserRevealRequest, FileItem } from '@floegence/floe-webapp-core/file-browser';
import { SURFACE_PORTAL_LAYER_ATTR } from '@floegence/floe-webapp-core/ui';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileBrowserWorkspace } from './FileBrowserWorkspace';
import {
  REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_ATTR,
  REDEVEN_WORKBENCH_WHEEL_ROLE_ATTR,
  REDEVEN_WORKBENCH_WHEEL_ROLE_LOCAL_SCROLL_VIEWPORT,
} from '../workbench/surface/workbenchWheelInteractive';
import {
  FLOE_DIALOG_SURFACE_HOST_ATTR,
  REDEVEN_WORKBENCH_WIDGET_ID_ATTR,
  REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR,
} from '../workbench/surface/workbenchInputRouting';

const resizeObserverState = {
  observers: [] as Array<{
    callback: ResizeObserverCallback;
    elements: Element[];
  }>,
};

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

type RafQueueEntry = {
  id: number;
  callback: FrameRequestCallback;
};

function createManualRafQueue() {
  let nextId = 0;
  const queue: RafQueueEntry[] = [];

  return {
    request(callback: FrameRequestCallback) {
      const id = ++nextId;
      queue.push({ id, callback });
      return id;
    },
    cancel(id: number) {
      const index = queue.findIndex((entry) => entry.id === id);
      if (index >= 0) {
        queue.splice(index, 1);
      }
    },
    flush() {
      const pending = queue.splice(0);
      for (const entry of pending) {
        entry.callback(performance.now());
      }
    },
  };
}

function dispatchPointerDown(target: EventTarget, options: {
  button?: number;
  clientX?: number;
  clientY?: number;
  pointerId?: number;
} = {}) {
  const EventCtor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  const event = new EventCtor('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: options.button ?? 0,
    clientX: options.clientX ?? 0,
    clientY: options.clientY ?? 0,
  });
  if (!('pointerId' in event)) {
    Object.defineProperty(event, 'pointerId', {
      configurable: true,
      value: options.pointerId ?? 1,
    });
  }
  if (!('pointerType' in event)) {
    Object.defineProperty(event, 'pointerType', {
      configurable: true,
      value: 'mouse',
    });
  }
  target.dispatchEvent(event);
}

function expectCodeBadgeForFile(host: HTMLElement, fileName: string, label: string, tone: string) {
  const fileButton = Array.from(host.querySelectorAll('button'))
    .find((node) => node.textContent?.includes(fileName));

  expect(fileButton, `expected rendered file entry for ${fileName}`).toBeTruthy();

  const badge = fileButton?.querySelector('[data-code-badge-label]') as HTMLElement | null;
  expect(badge, `expected code badge for ${fileName}`).toBeTruthy();
  expect(badge?.getAttribute('data-code-badge-label')).toBe(label);
  expect(badge?.getAttribute('data-code-badge-tone')).toBe(tone);
}

function findGridLabel(tile: HTMLButtonElement | null, name: string) {
  if (!tile) return null;
  return Array.from(tile.querySelectorAll('span'))
    .find((node) => node.textContent === name) as HTMLSpanElement | null;
}

function countExactSpanText(root: ParentNode, value: string) {
  return Array.from(root.querySelectorAll('span'))
    .filter((node) => node.textContent === value)
    .length;
}

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })),
  });
}

function buildDeepFolderTree(): FileItem[] {
  const deepestPath = '/workspace/customer-facing-platform/services/really-long-nested-feature/config/runtime/assets/icons';
  return [
    {
      id: 'folder-workspace',
      name: 'workspace',
      type: 'folder',
      path: '/workspace',
      children: [
        {
          id: 'folder-customer-facing-platform',
          name: 'customer-facing-platform',
          type: 'folder',
          path: '/workspace/customer-facing-platform',
          children: [
            {
              id: 'folder-services',
              name: 'services',
              type: 'folder',
              path: '/workspace/customer-facing-platform/services',
              children: [
                {
                  id: 'folder-really-long-nested-feature',
                  name: 'really-long-nested-feature',
                  type: 'folder',
                  path: '/workspace/customer-facing-platform/services/really-long-nested-feature',
                  children: [
                    {
                      id: 'folder-config',
                      name: 'config',
                      type: 'folder',
                      path: '/workspace/customer-facing-platform/services/really-long-nested-feature/config',
                      children: [
                        {
                          id: 'folder-runtime',
                          name: 'runtime',
                          type: 'folder',
                          path: '/workspace/customer-facing-platform/services/really-long-nested-feature/config/runtime',
                          children: [
                            {
                              id: 'folder-assets',
                              name: 'assets',
                              type: 'folder',
                              path: '/workspace/customer-facing-platform/services/really-long-nested-feature/config/runtime/assets',
                              children: [
                                {
                                  id: 'folder-icons',
                                  name: 'icons',
                                  type: 'folder',
                                  path: deepestPath,
                                  children: [],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    { id: 'file-readme', name: 'README.md', type: 'file', path: '/README.md' },
  ];
}

function defineElementWidth(element: Element, width: number) {
  Object.defineProperty(element, 'offsetWidth', {
    configurable: true,
    get: () => width,
  });
}

function mockElementRect(element: Element, rect: {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      ...rect,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }),
  });
}

function mockScrollGeometry(element: HTMLElement, input: {
  top: number;
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}) {
  let scrollTop = input.scrollTop;
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    get: () => input.clientHeight,
  });
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    get: () => input.scrollHeight,
  });
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  mockElementRect(element, {
    left: 0,
    top: input.top,
    right: 260,
    bottom: input.top + input.clientHeight,
    width: 260,
    height: input.clientHeight,
  });
}

function triggerResizeObservers() {
  for (const observer of resizeObserverState.observers) {
    observer.callback(
      observer.elements.map((element) => ({
        target: element,
        contentRect: {
          width: (element as HTMLElement).offsetWidth ?? 0,
          height: 0,
          top: 0,
          left: 0,
          bottom: 0,
          right: (element as HTMLElement).offsetWidth ?? 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        },
      }) as ResizeObserverEntry),
      {} as ResizeObserver,
    );
  }
}

beforeEach(() => {
  mockMatchMedia(false);
  resizeObserverState.observers.length = 0;

  const localStorageStore = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => localStorageStore.get(key) ?? null,
      setItem: (key: string, value: string) => {
        localStorageStore.set(key, String(value));
      },
      removeItem: (key: string) => {
        localStorageStore.delete(key);
      },
      clear: () => {
        localStorageStore.clear();
      },
    },
  });

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    return window.setTimeout(() => callback(performance.now()), 0);
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
    window.clearTimeout(handle);
  });

  if (typeof PointerEvent === 'undefined') {
    class TestPointerEvent extends MouseEvent {
      pointerId: number;
      pointerType: string;
      isPrimary: boolean;

      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? '';
        this.isPrimary = init.isPrimary ?? true;
      }
    }

    vi.stubGlobal('PointerEvent', TestPointerEvent as unknown as typeof PointerEvent);
  }

  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    writable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    writable: true,
    value: vi.fn(),
  });

  vi.stubGlobal('ResizeObserver', class {
    private readonly record: {
      callback: ResizeObserverCallback;
      elements: Element[];
    };

    constructor(callback: ResizeObserverCallback) {
      this.record = {
        callback,
        elements: [],
      };
      resizeObserverState.observers.push(this.record);
    }

    observe(element: Element) {
      this.record.elements.push(element);
    }

    unobserve(element: Element) {
      this.record.elements = this.record.elements.filter((entry) => entry !== element);
    }

    disconnect() {
      this.record.elements = [];
    }
  });

  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    writable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FileBrowserWorkspace interactions', () => {
  const files: FileItem[] = [
    { id: 'folder-src', name: 'src', type: 'folder', path: '/src', children: [] },
    { id: 'file-readme', name: 'README.md', type: 'file', path: '/README.md' },
  ];

  it('keeps the Files/Git mode switch pinned in the shared sidebar shell', () => {
    let nextMode = '';
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <FileBrowserWorkspace
            mode="files"
            onModeChange={(mode) => {
              nextMode = mode;
            }}
            files={files}
            currentPath="/"
            initialPath="/"
            persistenceKey="test-files-workspace"
            instanceId="test-files-workspace"
            resetKey={0}
            width={260}
            open
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      expect(host.textContent).toContain('Mode');
      expect(host.querySelector('.redeven-git-browser')).toBeNull();
      expect(host.querySelector('[class*="git-browser-selection-"]')).toBeNull();
      const gitButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Git'));
      expect(gitButton).toBeTruthy();
      gitButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(nextMode).toBe('git');
    } finally {
      dispose();
    }
  });

  it('uses the content header button to reopen the files sidebar on mobile widgets', () => {
    mockMatchMedia(true);
    let toggleSidebarCount = 0;
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            files={files}
            currentPath="/"
            initialPath="/"
            persistenceKey="test-files-workspace-mobile"
            instanceId="test-files-workspace-mobile"
            resetKey={0}
            width={260}
            open={false}
            showMobileSidebarButton
            onToggleSidebar={() => {
              toggleSidebarCount += 1;
            }}
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      const sidebarButton = host.querySelector('button[aria-label="Toggle browser sidebar"]');
      expect(sidebarButton).toBeTruthy();
      expect(sidebarButton?.textContent).toContain('Sidebar');
      expect(sidebarButton?.className).toContain('redeven-surface-control');
      sidebarButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(toggleSidebarCount).toBe(1);
    } finally {
      dispose();
    }
  });

  it('renders toolbar end actions in the content header', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            files={files}
            currentPath="/"
            initialPath="/"
            persistenceKey="test-files-workspace-toolbar-actions"
            instanceId="test-files-workspace-toolbar-actions"
            resetKey={0}
            width={260}
            open
            toolbarEndActions={<button type="button">More</button>}
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      const moreButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'More');
      expect(moreButton).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it('starts in grid view for first-run workspaces and still allows switching back to list', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            files={files}
            currentPath="/"
            initialPath="/"
            persistenceKey="test-files-workspace-default-grid"
            instanceId="test-files-workspace-default-grid"
            resetKey={0}
            width={260}
            open
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      expect(host.querySelector('.redeven-file-list-compact')).toBeNull();

      const listButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'List');
      expect(listButton).toBeTruthy();

      listButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(host.querySelector('.redeven-file-list-compact')).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it('renders the shared drag preview when the custom workspace starts dragging a file item', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <FileBrowserDragProvider>
        <LayoutProvider>
          <div class="h-[560px]">
            <FileBrowserWorkspace
              mode="files"
              onModeChange={() => {}}
              files={files}
              currentPath="/"
              initialPath="/"
              persistenceKey="test-files-workspace-drag-preview"
              instanceId="test-files-workspace-drag-preview"
              resetKey={0}
              width={260}
              open
              onDragMove={() => {}}
            />
          </div>
        </LayoutProvider>
      </FileBrowserDragProvider>
    ), host);

    try {
      await flush();

      const fileTile = host.querySelector('button[title="README.md"]') as HTMLButtonElement | null;
      expect(fileTile).toBeTruthy();
      expect(countExactSpanText(document.body, 'README.md')).toBe(1);

      fileTile!.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: 24,
        clientY: 24,
      }));
      document.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 1,
        pointerType: 'mouse',
        clientX: 48,
        clientY: 48,
      }));
      await flush();

      expect(countExactSpanText(document.body, 'README.md')).toBeGreaterThan(1);

      document.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 1,
        pointerType: 'mouse',
        clientX: 48,
        clientY: 48,
      }));
      await flush();
    } finally {
      dispose();
    }
  });

  it('uses tile-level hover titles and single-line ellipsis labels for long names in grid mode', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const longFolderName = 'customer-facing-platform-runtime-assets-and-shared-icons';
    const longFileName = '2026-quarterly-forecast-and-platform-capacity-report.final.reviewed.xlsx';

    const dispose = render(() => (
      <LayoutProvider>
        <div style={{ height: '720px', width: '960px' }}>
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            files={[
              { id: 'folder-long', name: longFolderName, type: 'folder', path: `/${longFolderName}`, children: [] },
              { id: 'file-long', name: longFileName, type: 'file', path: `/${longFileName}` },
            ]}
            currentPath="/"
            initialPath="/"
            persistenceKey="test-files-workspace-grid-long-names"
            instanceId="test-files-workspace-grid-long-names"
            resetKey={0}
            width={260}
            open
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const folderTile = host.querySelector(`button[title="${longFolderName}"]`) as HTMLButtonElement | null;
      const fileTile = host.querySelector(`button[title="${longFileName}"]`) as HTMLButtonElement | null;

      expect(folderTile).toBeTruthy();
      expect(fileTile).toBeTruthy();
      expect(folderTile?.getAttribute('title')).toBe(longFolderName);
      expect(fileTile?.getAttribute('title')).toBe(longFileName);

      const folderLabel = findGridLabel(folderTile, longFolderName);
      const fileLabel = findGridLabel(fileTile, longFileName);

      expect(folderLabel).toBeTruthy();
      expect(fileLabel).toBeTruthy();
      expect(folderLabel?.className).toContain('truncate');
      expect(fileLabel?.className).toContain('truncate');
      expect(folderLabel?.className).not.toContain('line-clamp-2');
      expect(fileLabel?.className).not.toContain('line-clamp-2');
    } finally {
      dispose();
    }
  });

  it('routes page-level typing into the filter field when the browser page is the active surface', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            captureTypingFromPage
            files={files}
            currentPath="/"
            initialPath="/"
            persistenceKey="test-files-workspace-type-to-filter-page"
            instanceId="test-files-workspace-type-to-filter-page"
            resetKey={0}
            width={260}
            open
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      const filterInput = host.querySelector('input[aria-label="Filter files"]') as HTMLInputElement | null;
      expect(filterInput).toBeTruthy();
      expect(document.activeElement === document.body || document.activeElement === host.ownerDocument?.body).toBe(true);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
      await flush();

      expect(filterInput!.value).toBe('r');
    } finally {
      dispose();
    }
  });

  it('requires in-component focus before routing typing when used as a workbench widget surface', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            files={files}
            currentPath="/"
            initialPath="/"
            persistenceKey="test-files-workspace-type-to-filter-widget"
            instanceId="test-files-workspace-type-to-filter-widget"
            resetKey={0}
            width={260}
            open
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      const filterInput = host.querySelector('input[aria-label="Filter files"]') as HTMLInputElement | null;
      const readmeButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('README.md')) as HTMLButtonElement | undefined;
      expect(filterInput).toBeTruthy();
      expect(readmeButton).toBeTruthy();

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
      await flush();
      expect(filterInput!.value).toBe('');

      readmeButton!.focus();
      readmeButton!.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
      await flush();

      expect(filterInput!.value).toBe('r');
    } finally {
      dispose();
    }
  });

  it('does not steal typing from specific input controls inside the browser chrome', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            captureTypingFromPage
            files={files}
            currentPath="/"
            initialPath="/"
            persistenceKey="test-files-workspace-type-to-filter-input-exemption"
            instanceId="test-files-workspace-type-to-filter-input-exemption"
            resetKey={0}
            width={260}
            open
            toolbarEndActions={<input aria-label="Custom widget input" value="" />}
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      const filterInput = host.querySelector('input[aria-label="Filter files"]') as HTMLInputElement | null;
      const customInput = host.querySelector('input[aria-label="Custom widget input"]') as HTMLInputElement | null;
      expect(filterInput).toBeTruthy();
      expect(customInput).toBeTruthy();

      customInput!.focus();
      customInput!.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
      await flush();

      expect(filterInput!.value).toBe('');
      expect(document.activeElement).toBe(customInput);
    } finally {
      dispose();
    }
  });

  it('opens the path editor from the current breadcrumb segment', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            files={[
              { id: 'folder-src', name: 'src', type: 'folder', path: '/Users/tester/src', children: [] },
            ]}
            currentPath="/Users/tester/src"
            initialPath="/Users/tester/src"
            homePath="/Users/tester"
            persistenceKey="test-files-workspace-path-editor-click"
            instanceId="test-files-workspace-path-editor-click"
            resetKey={0}
            width={260}
            open
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      const breadcrumb = host.querySelector('nav[aria-label="Breadcrumb"]') as HTMLElement | null;
      const currentPathButton = Array.from(breadcrumb?.querySelectorAll('button') ?? [])
        .filter((node) => node.closest('[aria-hidden="true"]') === null)
        .at(-1) as HTMLButtonElement | undefined;
      expect(currentPathButton).toBeTruthy();

      currentPathButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      const pathInput = host.querySelector('input[aria-label="Go to path"]') as HTMLInputElement | null;
      expect(pathInput).toBeTruthy();
      expect(pathInput?.value).toBe('~/src');
    } finally {
      dispose();
    }
  });

  it('opens the path editor with Ctrl+L and submits normalized paths through the workspace callback', async () => {
    let submittedPath = '';
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            captureTypingFromPage
            files={[
              { id: 'folder-src', name: 'src', type: 'folder', path: '/Users/tester/src', children: [] },
            ]}
            currentPath="/Users/tester/src"
            initialPath="/Users/tester/src"
            homePath="/Users/tester"
            persistenceKey="test-files-workspace-path-editor-shortcut"
            instanceId="test-files-workspace-path-editor-shortcut"
            resetKey={0}
            width={260}
            open
            onPathSubmit={async (path) => {
              submittedPath = path;
              return { status: 'ready', committedPath: path };
            }}
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, bubbles: true }));
      await flush();

      const pathInput = host.querySelector('input[aria-label="Go to path"]') as HTMLInputElement | null;
      expect(pathInput).toBeTruthy();
      expect(pathInput?.value).toBe('~/src');

      pathInput!.value = '~/project';
      pathInput!.dispatchEvent(new Event('input', { bubbles: true }));
      pathInput!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flush();

      expect(submittedPath).toBe('/Users/tester/project');
      expect(host.querySelector('input[aria-label="Go to path"]')).toBeNull();
    } finally {
      dispose();
    }
  });

  it('submits the operating system root without rewriting it to Home and keeps toolbar controls interactive', async () => {
    let submittedPath = '';
    let rootSelectedPath = '';
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            captureTypingFromPage
            files={[
              { id: '/', name: 'Computer', type: 'folder', path: '/', children: [
                { id: '/Users', name: 'Users', type: 'folder', path: '/Users', children: [] },
              ] },
            ]}
            currentPath="/"
            initialPath="/"
            homePath="/Users/tester"
            roots={[
              { id: 'home', label: 'Home', kind: 'home', pathAbs: '/Users/tester', permissions: { read: true, write: true }, system: true },
              { id: 'computer', label: 'Computer', kind: 'computer', pathAbs: '/', permissions: { read: true, write: false }, system: true },
            ]}
            persistenceKey="test-files-workspace-os-root-path-editor"
            instanceId="test-files-workspace-os-root-path-editor"
            resetKey={0}
            width={260}
            open
            onRootSelect={(path) => {
              rootSelectedPath = path;
            }}
            onPathSubmit={async (path) => {
              submittedPath = path;
              return { status: 'ready', committedPath: path };
            }}
            toolbarEndActions={(
              <>
                <button type="button">Refresh</button>
                <button type="button" aria-label="More file browser options">More</button>
              </>
            )}
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      const filterInput = host.querySelector('input[aria-label="Filter files"]') as HTMLInputElement | null;
      const moreButton = host.querySelector('button[aria-label="More file browser options"]') as HTMLButtonElement | null;
      const refreshButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Refresh')) as HTMLButtonElement | undefined;
      const listButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'List') as HTMLButtonElement | undefined;
      const gridButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'Grid') as HTMLButtonElement | undefined;

      expect(filterInput).toBeTruthy();
      expect(moreButton).toBeTruthy();
      expect(refreshButton).toBeTruthy();
      expect(listButton).toBeTruthy();
      expect(gridButton).toBeTruthy();

      const computerRoot = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Computer')) as HTMLButtonElement | undefined;
      expect(computerRoot).toBeTruthy();
      expect(host.querySelector('[data-tree-row-path="/Users"]')).toBeTruthy();
      expect(host.querySelector('[data-filesystem-root-id="home"]')).toBeTruthy();
      expect(host.querySelector('[data-filesystem-root-id="computer"]')).toBeTruthy();
      expect(host.querySelector('[data-filesystem-root-id="computer"] button[aria-current="page"]')).toBeTruthy();
      computerRoot!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      expect(rootSelectedPath).toBe('/');

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, bubbles: true }));
      await flush();

      const pathInput = host.querySelector('input[aria-label="Go to path"]') as HTMLInputElement | null;
      expect(pathInput).toBeTruthy();
      expect(pathInput?.value).toBe('/');

      pathInput!.value = '/';
      pathInput!.dispatchEvent(new Event('input', { bubbles: true }));
      pathInput!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flush();

      expect(submittedPath).toBe('/');
      expect(host.querySelector('input[aria-label="Go to path"]')).toBeNull();
    } finally {
      dispose();
    }
  });

  it('keeps root navigation separate from the RO/RW toggle hit area', async () => {
    let rootSelectedPath = '';
    const writePermissionChanges: Array<{ id: string; write: boolean }> = [];
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            files={[{ id: '/', name: 'Computer', type: 'folder', path: '/', children: [] }]}
            currentPath="/"
            initialPath="/"
            homePath="/Users/tester"
            roots={[
              { id: 'home', label: 'Home', kind: 'home', pathAbs: '/Users/tester', permissions: { read: true, write: true }, system: true },
              { id: 'computer', label: 'Computer', kind: 'computer', pathAbs: '/', permissions: { read: true, write: true }, system: true },
            ]}
            persistenceKey="test-files-workspace-root-write-toggle"
            instanceId="test-files-workspace-root-write-toggle"
            resetKey={0}
            width={260}
            open
            onRootSelect={(path) => {
              rootSelectedPath = path;
            }}
            onRootWritePermissionChange={(root, write) => {
              writePermissionChanges.push({ id: root.id, write });
            }}
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      expect(host.querySelector('[data-filesystem-root-write-toggle="home"]')).toBeNull();
      const homeBadge = host.querySelector('[data-filesystem-root-write-badge="home"]');
      expect(homeBadge?.textContent?.trim()).toBe('RW');
      const computerToggle = host.querySelector('[data-filesystem-root-write-toggle="computer"]');
      const computerReadOnlyButton = Array.from(computerToggle?.querySelectorAll('button') ?? [])
        .find((node) => node.textContent?.trim() === 'RO') as HTMLButtonElement | undefined;
      expect(computerToggle).toBeTruthy();
      expect(computerToggle?.textContent?.trim()).toBe('RORW');
      expect(computerReadOnlyButton).toBeTruthy();
      computerReadOnlyButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await flush();

      expect(rootSelectedPath).toBe('');
      expect(writePermissionChanges).toEqual([{ id: 'computer', write: false }]);
    } finally {
      dispose();
    }
  });

  it('requires confirmation before enabling Computer RW from the root row', async () => {
    let rootSelectedPath = '';
    const writePermissionChanges: Array<{ id: string; write: boolean }> = [];
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            files={[{ id: '/', name: 'Computer', type: 'folder', path: '/', children: [] }]}
            currentPath="/"
            initialPath="/"
            homePath="/Users/tester"
            roots={[
              { id: 'home', label: 'Home', kind: 'home', pathAbs: '/Users/tester', permissions: { read: true, write: true }, system: true },
              { id: 'computer', label: 'Computer', kind: 'computer', pathAbs: '/', permissions: { read: true, write: false }, system: true },
            ]}
            persistenceKey="test-files-workspace-root-write-confirm"
            instanceId="test-files-workspace-root-write-confirm"
            resetKey={0}
            width={260}
            open
            onRootSelect={(path) => {
              rootSelectedPath = path;
            }}
            onRootWritePermissionChange={(root, write) => {
              writePermissionChanges.push({ id: root.id, write });
            }}
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      const computerToggle = host.querySelector('[data-filesystem-root-write-toggle="computer"]');
      const computerReadOnlyButton = Array.from(computerToggle?.querySelectorAll('button') ?? [])
        .find((node) => node.textContent?.trim() === 'RO') as HTMLButtonElement | undefined;
      const computerReadWriteButton = Array.from(computerToggle?.querySelectorAll('button') ?? [])
        .find((node) => node.textContent?.trim() === 'RW') as HTMLButtonElement | undefined;
      expect(computerToggle).toBeTruthy();
      expect(computerToggle?.textContent?.trim()).toBe('RORW');
      expect(computerReadOnlyButton).toBeTruthy();
      expect(computerReadWriteButton).toBeTruthy();

      computerReadOnlyButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await flush();
      expect(rootSelectedPath).toBe('');
      expect(writePermissionChanges).toEqual([]);
      expect(document.body.textContent).not.toContain('Enable write access for Computer?');

      computerReadWriteButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await flush();
      expect(rootSelectedPath).toBe('');
      expect(writePermissionChanges).toEqual([]);
      expect(document.body.textContent).toContain('Enable write access for Computer?');

      const cancelButton = Array.from(document.body.querySelectorAll('button'))
        .find((node) => node.textContent?.trim() === 'Cancel') as HTMLButtonElement | undefined;
      expect(cancelButton).toBeTruthy();
      cancelButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await flush();
      expect(writePermissionChanges).toEqual([]);

      computerReadWriteButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await flush();
      const confirmButton = Array.from(document.body.querySelectorAll('button'))
        .find((node) => node.textContent?.trim() === 'Enable RW') as HTMLButtonElement | undefined;
      expect(confirmButton).toBeTruthy();
      confirmButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await flush();

      expect(rootSelectedPath).toBe('');
      expect(writePermissionChanges).toEqual([{ id: 'computer', write: true }]);
    } finally {
      dispose();
    }
  });

  it('keeps the path editor open and shows inline feedback when the entered path is invalid', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            captureTypingFromPage
            files={[
              { id: 'folder-src', name: 'src', type: 'folder', path: '/Users/tester/src', children: [] },
            ]}
            currentPath="/Users/tester/src"
            initialPath="/Users/tester/src"
            homePath="/Users/tester"
            persistenceKey="test-files-workspace-path-editor-invalid"
            instanceId="test-files-workspace-path-editor-invalid"
            resetKey={0}
            width={260}
            open
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, bubbles: true }));
      await flush();

      const pathInput = host.querySelector('input[aria-label="Go to path"]') as HTMLInputElement | null;
      expect(pathInput).toBeTruthy();

      pathInput!.value = '../outside';
      pathInput!.dispatchEvent(new Event('input', { bubbles: true }));
      pathInput!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flush();

      expect(host.querySelector('input[aria-label="Go to path"]')).toBeTruthy();
      expect(host.textContent).toContain('Use "/" or "~" to enter a path.');
    } finally {
      dispose();
    }
  });

  it('returns to the breadcrumb after the path input loses focus', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            captureTypingFromPage
            files={[
              { id: 'folder-src', name: 'src', type: 'folder', path: '/Users/tester/src', children: [] },
            ]}
            currentPath="/Users/tester/src"
            initialPath="/Users/tester/src"
            homePath="/Users/tester"
            persistenceKey="test-files-workspace-path-editor-blur"
            instanceId="test-files-workspace-path-editor-blur"
            resetKey={0}
            width={260}
            open
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, bubbles: true }));
      await flush();

      const pathInput = host.querySelector('input[aria-label="Go to path"]') as HTMLInputElement | null;
      expect(pathInput).toBeTruthy();

      pathInput!.dispatchEvent(new FocusEvent('blur'));
      await flush();

      expect(host.querySelector('input[aria-label="Go to path"]')).toBeNull();
      expect(host.querySelector('nav[aria-label="Breadcrumb"]')).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it('treats the path edit request key as an edge-trigger instead of reopening after submit state changes', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const [pathEditRequestKey, setPathEditRequestKey] = createSignal(0);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            captureTypingFromPage
            files={[
              { id: 'folder-src', name: 'src', type: 'folder', path: '/Users/tester/src', children: [] },
            ]}
            currentPath="/Users/tester/src"
            initialPath="/Users/tester/src"
            homePath="/Users/tester"
            persistenceKey="test-files-workspace-path-editor-request-key"
            instanceId="test-files-workspace-path-editor-request-key"
            resetKey={0}
            width={260}
            open
            pathEditRequestKey={pathEditRequestKey()}
            onPathSubmit={async (path) => ({ status: 'ready', committedPath: path })}
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      setPathEditRequestKey(1);
      await flush();

      const pathInput = host.querySelector('input[aria-label="Go to path"]') as HTMLInputElement | null;
      expect(pathInput).toBeTruthy();

      pathInput!.value = '~/project';
      pathInput!.dispatchEvent(new Event('input', { bubbles: true }));
      pathInput!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flush();

      expect(host.querySelector('input[aria-label="Go to path"]')).toBeNull();
    } finally {
      dispose();
    }
  });

  it('uses a shared toolbar control height across actions, fields, and view switcher', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            files={files}
            currentPath="/"
            initialPath="/"
            persistenceKey="test-files-workspace-toolbar-heights"
            instanceId="test-files-workspace-toolbar-heights"
            resetKey={0}
            width={260}
            open
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      const upButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Up'));
      const breadcrumb = host.querySelector('nav[aria-label="Breadcrumb"]');
      const filterInput = host.querySelector('input[aria-label="Filter files"]');
      const viewSwitcher = host.querySelector('[role="group"]');

      expect(upButton?.className).toContain('h-7');
      expect(upButton?.className).toContain('redeven-surface-control');
      expect(breadcrumb?.parentElement?.className).toContain('h-7');
      expect(breadcrumb?.parentElement?.className).toContain('redeven-surface-control--muted');
      expect(filterInput?.parentElement?.className).toContain('h-7');
      expect(filterInput?.parentElement?.className).toContain('redeven-surface-control--muted');
      expect(viewSwitcher?.className).toContain('h-7');
      expect(viewSwitcher?.className).toContain('redeven-surface-segmented');
    } finally {
      dispose();
    }
  });

  it('switches the workspace header between inline and stacked layouts based on container width', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            files={files}
            currentPath="/"
            initialPath="/"
            persistenceKey="test-files-workspace-toolbar-layout"
            instanceId="test-files-workspace-toolbar-layout"
            resetKey={0}
            width={260}
            open
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      const toolbar = host.querySelector('[data-toolbar-layout]') as HTMLDivElement | null;
      expect(toolbar).toBeTruthy();

      defineElementWidth(toolbar!, 560);
      triggerResizeObservers();
      await flush();
      expect(toolbar?.getAttribute('data-toolbar-layout')).toBe('stacked');

      defineElementWidth(toolbar!, 760);
      triggerResizeObservers();
      await flush();
      expect(toolbar?.getAttribute('data-toolbar-layout')).toBe('inline');
    } finally {
      dispose();
    }
  });

  it('shows directories nearest the current path when the breadcrumb has moderate width', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            files={buildDeepFolderTree()}
            currentPath="/workspace/customer-facing-platform/services/really-long-nested-feature/config/runtime/assets/icons"
            initialPath="/workspace/customer-facing-platform/services/really-long-nested-feature/config/runtime/assets/icons"
            persistenceKey="test-files-workspace-breadcrumb-layout"
            instanceId="test-files-workspace-breadcrumb-layout"
            resetKey={0}
            width={260}
            open
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      const breadcrumb = host.querySelector('nav[aria-label="Breadcrumb"]') as HTMLElement | null;
      expect(breadcrumb).toBeTruthy();

      const hiddenMeasure = breadcrumb?.querySelector('div[aria-hidden="true"]') as HTMLDivElement | null;
      expect(hiddenMeasure).toBeTruthy();

      defineElementWidth(breadcrumb!, 320);
      const measureChildren = Array.from(hiddenMeasure!.children);
      const segmentWidths = [44, 84, 120, 72, 120, 60, 66, 58];
      for (const [index, width] of segmentWidths.entries()) {
        defineElementWidth(measureChildren[index]!, width);
      }
      defineElementWidth(measureChildren[segmentWidths.length]!, 12);
      defineElementWidth(measureChildren[segmentWidths.length + 1]!, 28);

      triggerResizeObservers();
      await flush();

      const visibleButtons = Array.from(breadcrumb!.querySelectorAll('button'))
        .filter((node) => node.closest('[aria-hidden="true"]') === null)
        .map((node) => node.textContent?.trim())
        .filter(Boolean);

      expect(visibleButtons).toContain('Home');
      expect(visibleButtons).toContain('assets');
      expect(visibleButtons).toContain('icons');
      expect(visibleButtons).toContain('…');
      expect(visibleButtons).not.toContain('workspace');
    } finally {
      dispose();
    }
  });

  it('treats homePath as the navigation root and maps navigate-up back to the absolute home path', async () => {
    let navigatedPath = '';
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            files={[
              { id: 'folder-src', name: 'src', type: 'folder', path: '/Users/tester/src', children: [] },
              { id: 'file-readme', name: 'README.md', type: 'file', path: '/Users/tester/README.md' },
            ]}
            currentPath="/Users/tester/src"
            initialPath="/Users/tester/src"
            homePath="/Users/tester"
            persistenceKey="test-files-workspace-home-root"
            instanceId="test-files-workspace-home-root"
            resetKey={0}
            width={260}
            open
            onNavigate={(path) => {
              navigatedPath = path;
            }}
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      const upButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Up'));
      expect(upButton).toBeTruthy();
      upButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(navigatedPath).toBe('/Users/tester');
      expect(host.textContent).toContain('Home');
    } finally {
      dispose();
    }
  });

  it('resolves override context menu items from the right-click target items', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const openInTerminalSpy = vi.fn();

    const resolveOverrideContextMenuItems = (event: ContextMenuEvent | null): ContextMenuItem[] => {
      if (event?.targetKind === 'item' && event.items.length === 1 && event.items[0]?.type === 'folder') {
        return [
          {
            id: 'open-in-terminal',
            label: 'Open in Terminal',
            type: 'custom',
            onAction: (_items, menuEvent) => openInTerminalSpy(menuEvent),
          },
        ];
      }
      return [];
    };

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            files={files}
            currentPath="/"
            initialPath="/"
            persistenceKey="test-files-workspace-context-menu-resolver"
            instanceId="test-files-workspace-context-menu-resolver"
            resetKey={0}
            width={260}
            open
            resolveOverrideContextMenuItems={resolveOverrideContextMenuItems}
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const folderButton = host.querySelector('button[title="src"]') as HTMLButtonElement | null;
      const readmeButton = host.querySelector('button[title="README.md"]') as HTMLButtonElement | null;
      expect(folderButton).toBeTruthy();
      expect(readmeButton).toBeTruthy();

      folderButton!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 24, clientY: 32 }));
      await flush();

      const openButton = Array.from(document.body.querySelectorAll('[role="menu"] button')).find((node) => node.textContent?.includes('Open in Terminal')) as HTMLButtonElement | undefined;
      expect(openButton).toBeTruthy();

      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      readmeButton!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 44 }));
      await flush();

      const hiddenOpenButton = Array.from(document.body.querySelectorAll('[role="menu"] button')).find((node) => node.textContent?.includes('Open in Terminal')) as HTMLButtonElement | undefined;
      expect(hiddenOpenButton).toBeUndefined();
      expect(openInTerminalSpy).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('keeps surface-scoped context menu items clickable inside a workbench host', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const duplicateSpy = vi.fn();

    const dispose = render(() => (
      <LayoutProvider>
        <article
          {...{ [FLOE_DIALOG_SURFACE_HOST_ATTR]: 'true' }}
          {...{ [REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR]: 'true' }}
          {...{ [REDEVEN_WORKBENCH_WIDGET_ID_ATTR]: 'widget-files-1' }}
          class="relative h-[560px]"
        >
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            files={files}
            currentPath="/"
            initialPath="/"
            persistenceKey="test-files-workspace-surface-context-menu"
            instanceId="test-files-workspace-surface-context-menu"
            resetKey={0}
            width={260}
            open
            contextMenuCallbacks={{ onDuplicate: duplicateSpy }}
          />
        </article>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const folderButton = host.querySelector('button[title="src"]') as HTMLButtonElement | null;
      const surfaceHost = host.querySelector(`[${FLOE_DIALOG_SURFACE_HOST_ATTR}="true"]`) as HTMLElement | null;
      expect(folderButton).toBeTruthy();
      expect(surfaceHost).toBeTruthy();

      folderButton!.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 1,
        pointerType: 'mouse',
        button: 2,
        clientX: 24,
        clientY: 32,
      }));
      folderButton!.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 24,
        clientY: 32,
      }));
      await flush();
      await flush();

      const menu = surfaceHost!.querySelector('[role="menu"]') as HTMLElement | null;
      const duplicateButton = Array.from(menu?.querySelectorAll('button') ?? []).find((node) => node.textContent?.includes('Duplicate')) as HTMLButtonElement | undefined;
      expect(menu).toBeTruthy();
      expect(menu?.getAttribute('data-floe-local-interaction-surface')).toBe('true');
      expect(duplicateButton).toBeTruthy();

      dispatchPointerDown(duplicateButton!);
      duplicateButton!.click();
      await flush();
      await flush();

      expect(duplicateSpy).toHaveBeenCalledTimes(1);
      expect(duplicateSpy.mock.calls[0]?.[0]?.[0]?.path).toBe('/src');
    } finally {
      dispose();
    }
  });

  it('shows the workbench surface context menu only after resolving its final clamped position', async () => {
    const manualRaf = createManualRafQueue();
    vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => (
      manualRaf.request(callback)
    )) as typeof requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', ((handle: number) => {
      manualRaf.cancel(handle);
    }) as typeof cancelAnimationFrame);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div
          {...{ [SURFACE_PORTAL_LAYER_ATTR]: 'true' }}
          class="relative h-[360px] w-[520px]"
          data-testid="surface-portal-layer"
        >
          <article
            {...{ [FLOE_DIALOG_SURFACE_HOST_ATTR]: 'true' }}
            {...{ [REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR]: 'true' }}
            {...{ [REDEVEN_WORKBENCH_WIDGET_ID_ATTR]: 'widget-files-position' }}
            class="absolute h-[240px] w-[320px]"
            data-testid="surface-host"
          >
            <FileBrowserWorkspace
              mode="files"
              onModeChange={() => {}}
              files={files}
              currentPath="/"
              initialPath="/"
              persistenceKey="test-files-workspace-surface-context-menu-position"
              instanceId="test-files-workspace-surface-context-menu-position"
              resetKey={0}
              width={260}
              open
              contextMenuCallbacks={{ onDuplicate: vi.fn() }}
            />
          </article>
        </div>
      </LayoutProvider>
    ), host);

    try {
      await Promise.resolve();

      const surfaceLayer = host.querySelector('[data-testid="surface-portal-layer"]') as HTMLElement | null;
      const surfaceHost = host.querySelector('[data-testid="surface-host"]') as HTMLElement | null;
      const folderButton = host.querySelector('button[title="src"]') as HTMLButtonElement | null;
      expect(surfaceLayer).toBeTruthy();
      expect(surfaceHost).toBeTruthy();
      expect(folderButton).toBeTruthy();

      mockElementRect(surfaceLayer!, {
        left: 20,
        top: 30,
        right: 540,
        bottom: 390,
        width: 520,
        height: 360,
      });
      mockElementRect(surfaceHost!, {
        left: 120,
        top: 80,
        right: 440,
        bottom: 320,
        width: 320,
        height: 240,
      });

      folderButton!.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 1,
        pointerType: 'mouse',
        button: 2,
        clientX: 430,
        clientY: 315,
      }));
      folderButton!.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 430,
        clientY: 315,
      }));
      await Promise.resolve();

      const menu = surfaceLayer!.querySelector('[role="menu"]') as HTMLElement | null;
      expect(menu).toBeTruthy();
      expect(surfaceLayer?.contains(menu ?? null)).toBe(true);
      expect(surfaceHost?.contains(menu ?? null)).toBe(false);
      expect(menu?.style.left).toBe('410px');
      expect(menu?.style.top).toBe('285px');
      expect(menu?.style.visibility).toBe('hidden');
      expect(menu?.style.pointerEvents).toBe('none');
      expect(menu?.getAttribute('aria-hidden')).toBe('true');

      const duplicateButton = Array.from(menu!.querySelectorAll('button')).find((node) =>
        node.textContent?.includes('Duplicate')
      ) as HTMLButtonElement | undefined;
      expect(duplicateButton).toBeTruthy();
      expect(document.activeElement).not.toBe(duplicateButton);

      mockElementRect(menu!, {
        left: 430,
        top: 315,
        right: 630,
        bottom: 435,
        width: 200,
        height: 120,
      });

      manualRaf.flush();
      await Promise.resolve();

      expect(menu?.style.visibility).toBe('visible');
      expect(menu?.style.pointerEvents).toBe('auto');
      expect(menu?.getAttribute('aria-hidden')).toBeNull();
      expect(menu?.style.left).toBe('212px');
      expect(menu?.style.top).toBe('162px');
      expect(document.activeElement).toBe(duplicateButton);
    } finally {
      dispose();
    }
  });

  it('emits a directory-background context event for empty workspace right clicks', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let backgroundEvent: ContextMenuEvent | null = null;

    const resolveOverrideContextMenuItems = (event: ContextMenuEvent | null): ContextMenuItem[] => {
      if (event?.targetKind !== 'directory-background') return [];
      backgroundEvent = event;
      return [
        {
          id: 'open-in-terminal',
          label: 'Open in Terminal',
          type: 'custom',
        },
      ];
    };

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            files={files}
            currentPath="/"
            initialPath="/"
            persistenceKey="test-files-workspace-background-context-menu"
            instanceId="test-files-workspace-background-context-menu"
            resetKey={0}
            width={260}
            open
            resolveOverrideContextMenuItems={resolveOverrideContextMenuItems}
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const contentRegion = host.querySelector('[data-testid="file-browser-content-scroll-region"]') as HTMLDivElement | null;
      expect(contentRegion).toBeTruthy();
      expect(contentRegion?.getAttribute(REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_ATTR)).toBe('true');
      expect(contentRegion?.getAttribute(REDEVEN_WORKBENCH_WHEEL_ROLE_ATTR)).toBe(REDEVEN_WORKBENCH_WHEEL_ROLE_LOCAL_SCROLL_VIEWPORT);

      contentRegion!.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 64,
        clientY: 72,
      }));
      await flush();

      expect(backgroundEvent).toMatchObject({
        targetKind: 'directory-background',
        source: 'background',
        items: [],
        directory: {
          path: '/',
        },
      });
    } finally {
      dispose();
    }
  });

  it('keeps the file tree on a dedicated sidebar scroll region', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            files={Array.from({ length: 24 }, (_, index) => ({ id: `folder-${index}`, name: `folder-${index}`, type: 'folder', path: `/folder-${index}`, children: [] }))}
            currentPath="/"
            initialPath="/"
            persistenceKey="test-files-workspace-scroll"
            instanceId="test-files-workspace-scroll"
            resetKey={0}
            width={260}
            open
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      const scrollRegion = host.querySelector('[data-testid="file-tree-scroll-region"]');
      expect(scrollRegion).toBeTruthy();
      expect(scrollRegion?.getAttribute(REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_ATTR)).toBe('true');
      expect(scrollRegion?.getAttribute(REDEVEN_WORKBENCH_WHEEL_ROLE_ATTR)).toBe(REDEVEN_WORKBENCH_WHEEL_ROLE_LOCAL_SCROLL_VIEWPORT);
      expect(scrollRegion?.className).toContain('overflow-auto');
      expect(scrollRegion?.className).toContain('overflow-x-hidden');
      expect(scrollRegion?.className).toContain('overscroll-contain');
      expect(scrollRegion?.className).toContain('[-webkit-overflow-scrolling:touch]');
      expect(scrollRegion?.className).toContain('[touch-action:pan-y_pinch-zoom]');
      expect(scrollRegion?.textContent).toContain('folder-0');
      expect(scrollRegion?.textContent).toContain('folder-23');
    } finally {
      dispose();
    }
  });

  it('keeps a clicked tree row near the pointer when navigation prunes expanded branches above it', async () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const host = document.createElement('div');
    document.body.appendChild(host);

    const expandedTree: FileItem[] = [
      {
        id: '/workspace',
        name: 'workspace',
        type: 'folder',
        path: '/workspace',
        children: [
          {
            id: '/workspace/alpha',
            name: 'alpha',
            type: 'folder',
            path: '/workspace/alpha',
            children: [
              { id: '/workspace/alpha/one', name: 'one', type: 'folder', path: '/workspace/alpha/one', children: [] },
              { id: '/workspace/alpha/two', name: 'two', type: 'folder', path: '/workspace/alpha/two', children: [] },
              { id: '/workspace/alpha/three', name: 'three', type: 'folder', path: '/workspace/alpha/three', children: [] },
            ],
          },
          { id: '/workspace/beta', name: 'beta', type: 'folder', path: '/workspace/beta', children: [] },
        ],
      },
    ];

    const prunedTree: FileItem[] = [
      {
        id: '/workspace',
        name: 'workspace',
        type: 'folder',
        path: '/workspace',
        children: [
          { id: '/workspace/alpha', name: 'alpha', type: 'folder', path: '/workspace/alpha' },
          {
            id: '/workspace/beta',
            name: 'beta',
            type: 'folder',
            path: '/workspace/beta',
            children: [
              { id: '/workspace/beta/child', name: 'child', type: 'folder', path: '/workspace/beta/child', children: [] },
            ],
          },
        ],
      },
    ];

    const dispose = render(() => {
      const [tree, setTree] = createSignal(expandedTree);
      const [currentPath, setCurrentPath] = createSignal('/workspace/alpha/one');
      const [pendingPath, setPendingPath] = createSignal('');

      return (
        <LayoutProvider>
          <div class="h-[560px]">
            <FileBrowserWorkspace
              mode="files"
              onModeChange={() => {}}
              files={tree()}
              currentPath={currentPath()}
              pendingNavigationPath={pendingPath()}
              initialPath="/workspace/alpha/one"
              persistenceKey="test-files-workspace-click-anchor"
              instanceId="test-files-workspace-click-anchor"
              resetKey={0}
              width={260}
              open
              onNavigate={(path) => {
                setPendingPath(path);
                window.setTimeout(() => {
                  setTree(prunedTree);
                  setCurrentPath(path);
                  const nextBetaRow = host.querySelector('[data-tree-row-path="/workspace/beta"]') as HTMLElement | null;
                  if (nextBetaRow) {
                    mockElementRect(nextBetaRow, {
                      left: 0,
                      top: 170,
                      right: 240,
                      bottom: 190,
                      width: 240,
                      height: 20,
                    });
                  }
                  setPendingPath('');
                }, 0);
              }}
            />
          </div>
        </LayoutProvider>
      );
    }, host);

    try {
      await flush();

      const scrollRegion = host.querySelector('[data-testid="file-tree-scroll-region"]') as HTMLElement | null;
      expect(scrollRegion).toBeTruthy();
      mockScrollGeometry(scrollRegion!, {
        top: 100,
        clientHeight: 300,
        scrollHeight: 900,
        scrollTop: 200,
      });

      const betaRow = host.querySelector('[data-tree-row-path="/workspace/beta"]') as HTMLElement | null;
      expect(betaRow).toBeTruthy();
      mockElementRect(betaRow!, {
        left: 0,
        top: 240,
        right: 240,
        bottom: 260,
        width: 240,
        height: 20,
      });

      scrollIntoView.mockClear();
      betaRow!.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        clientY: 250,
        detail: 1,
      }));

      await Promise.resolve();
      await Promise.resolve();
      expect(scrollIntoView).not.toHaveBeenCalled();

      await flush();
      await flush();

      expect(scrollRegion!.scrollTop).toBe(130);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('lets scroll bounds clamp click-anchor preservation at the top of the file tree', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const treeBefore: FileItem[] = [
      {
        id: '/workspace',
        name: 'workspace',
        type: 'folder',
        path: '/workspace',
        children: [
          {
            id: '/workspace/alpha',
            name: 'alpha',
            type: 'folder',
            path: '/workspace/alpha',
            children: [
              { id: '/workspace/alpha/one', name: 'one', type: 'folder', path: '/workspace/alpha/one', children: [] },
              { id: '/workspace/alpha/two', name: 'two', type: 'folder', path: '/workspace/alpha/two', children: [] },
            ],
          },
          { id: '/workspace/beta', name: 'beta', type: 'folder', path: '/workspace/beta', children: [] },
        ],
      },
    ];
    const treeAfter: FileItem[] = [
      {
        id: '/workspace',
        name: 'workspace',
        type: 'folder',
        path: '/workspace',
        children: [
          { id: '/workspace/alpha', name: 'alpha', type: 'folder', path: '/workspace/alpha' },
          { id: '/workspace/beta', name: 'beta', type: 'folder', path: '/workspace/beta', children: [] },
        ],
      },
    ];

    const dispose = render(() => {
      const [tree, setTree] = createSignal(treeBefore);
      const [currentPath, setCurrentPath] = createSignal('/workspace/alpha/one');
      const [pendingPath, setPendingPath] = createSignal('');

      return (
        <LayoutProvider>
          <div class="h-[560px]">
            <FileBrowserWorkspace
              mode="files"
              onModeChange={() => {}}
              files={tree()}
              currentPath={currentPath()}
              pendingNavigationPath={pendingPath()}
              initialPath="/workspace/alpha/one"
              persistenceKey="test-files-workspace-click-anchor-top"
              instanceId="test-files-workspace-click-anchor-top"
              resetKey={0}
              width={260}
              open
              onNavigate={(path) => {
                setPendingPath(path);
                window.setTimeout(() => {
                  setTree(treeAfter);
                  setCurrentPath(path);
                  const nextBetaRow = host.querySelector('[data-tree-row-path="/workspace/beta"]') as HTMLElement | null;
                  if (nextBetaRow) {
                    mockElementRect(nextBetaRow, {
                      left: 0,
                      top: 90,
                      right: 240,
                      bottom: 110,
                      width: 240,
                      height: 20,
                    });
                  }
                  setPendingPath('');
                }, 0);
              }}
            />
          </div>
        </LayoutProvider>
      );
    }, host);

    try {
      await flush();

      const scrollRegion = host.querySelector('[data-testid="file-tree-scroll-region"]') as HTMLElement | null;
      expect(scrollRegion).toBeTruthy();
      mockScrollGeometry(scrollRegion!, {
        top: 100,
        clientHeight: 300,
        scrollHeight: 900,
        scrollTop: 20,
      });

      const betaRow = host.querySelector('[data-tree-row-path="/workspace/beta"]') as HTMLElement | null;
      expect(betaRow).toBeTruthy();
      mockElementRect(betaRow!, {
        left: 0,
        top: 240,
        right: 240,
        bottom: 260,
        width: 240,
        height: 20,
      });

      betaRow!.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        clientY: 250,
        detail: 1,
      }));

      await flush();
      await flush();

      expect(scrollRegion!.scrollTop).toBe(0);
    } finally {
      dispose();
    }
  });

  it('does not scroll back to the old tree row while a clicked navigation is pending', async () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const host = document.createElement('div');
    document.body.appendChild(host);

    const tree: FileItem[] = [
      {
        id: '/workspace',
        name: 'workspace',
        type: 'folder',
        path: '/workspace',
        children: [
          {
            id: '/workspace/alpha',
            name: 'alpha',
            type: 'folder',
            path: '/workspace/alpha',
            children: [
              { id: '/workspace/alpha/one', name: 'one', type: 'folder', path: '/workspace/alpha/one', children: [] },
            ],
          },
          { id: '/workspace/beta', name: 'beta', type: 'folder', path: '/workspace/beta', children: [] },
        ],
      },
    ];

    const dispose = render(() => {
      const [currentPath, setCurrentPath] = createSignal('/workspace/alpha/one');
      const [pendingPath, setPendingPath] = createSignal('');

      return (
        <LayoutProvider>
          <div class="h-[560px]">
            <FileBrowserWorkspace
              mode="files"
              onModeChange={() => {}}
              files={tree}
              currentPath={currentPath()}
              pendingNavigationPath={pendingPath()}
              initialPath="/workspace/alpha/one"
              persistenceKey="test-files-workspace-click-anchor-old-path"
              instanceId="test-files-workspace-click-anchor-old-path"
              resetKey={0}
              width={260}
              open
              onNavigate={(path) => {
                setPendingPath(path);
                queueMicrotask(() => setCurrentPath('/workspace/alpha/one'));
              }}
            />
          </div>
        </LayoutProvider>
      );
    }, host);

    try {
      await flush();

      const scrollRegion = host.querySelector('[data-testid="file-tree-scroll-region"]') as HTMLElement | null;
      expect(scrollRegion).toBeTruthy();
      mockScrollGeometry(scrollRegion!, {
        top: 100,
        clientHeight: 300,
        scrollHeight: 900,
        scrollTop: 200,
      });

      const betaRow = host.querySelector('[data-tree-row-path="/workspace/beta"]') as HTMLElement | null;
      expect(betaRow).toBeTruthy();
      mockElementRect(betaRow!, {
        left: 0,
        top: 240,
        right: 240,
        bottom: 260,
        width: 240,
        height: 20,
      });

      scrollIntoView.mockClear();
      betaRow!.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        clientY: 250,
        detail: 1,
      }));

      await flush();
      await flush();

      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('still scrolls programmatic tree path changes into view when there is no click anchor', async () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const host = document.createElement('div');
    document.body.appendChild(host);
    let setCurrentPath!: (path: string) => void;

    const tree: FileItem[] = [
      {
        id: '/workspace',
        name: 'workspace',
        type: 'folder',
        path: '/workspace',
        children: [
          { id: '/workspace/alpha', name: 'alpha', type: 'folder', path: '/workspace/alpha', children: [] },
          { id: '/workspace/beta', name: 'beta', type: 'folder', path: '/workspace/beta', children: [] },
        ],
      },
    ];

    const dispose = render(() => {
      const [currentPath, updateCurrentPath] = createSignal('/workspace/alpha');
      setCurrentPath = updateCurrentPath;

      return (
        <LayoutProvider>
          <div class="h-[560px]">
            <FileBrowserWorkspace
              mode="files"
              onModeChange={() => {}}
              files={tree}
              currentPath={currentPath()}
              pendingNavigationPath=""
              initialPath="/workspace/alpha"
              persistenceKey="test-files-workspace-programmatic-tree-scroll"
              instanceId="test-files-workspace-programmatic-tree-scroll"
              resetKey={0}
              width={260}
              open
            />
          </div>
        </LayoutProvider>
      );
    }, host);

    try {
      await flush();
      scrollIntoView.mockClear();

      setCurrentPath('/workspace/beta');
      await flush();
      await flush();

      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    } finally {
      dispose();
    }
  });

  it('lets scroll bounds clamp click-anchor preservation at the bottom of the file tree', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const treeBefore: FileItem[] = [
      {
        id: '/workspace',
        name: 'workspace',
        type: 'folder',
        path: '/workspace',
        children: [
          {
            id: '/workspace/alpha',
            name: 'alpha',
            type: 'folder',
            path: '/workspace/alpha',
            children: [
              { id: '/workspace/alpha/one', name: 'one', type: 'folder', path: '/workspace/alpha/one', children: [] },
              { id: '/workspace/alpha/two', name: 'two', type: 'folder', path: '/workspace/alpha/two', children: [] },
            ],
          },
          { id: '/workspace/beta', name: 'beta', type: 'folder', path: '/workspace/beta', children: [] },
        ],
      },
    ];
    const treeAfter: FileItem[] = [
      {
        id: '/workspace',
        name: 'workspace',
        type: 'folder',
        path: '/workspace',
        children: [
          { id: '/workspace/alpha', name: 'alpha', type: 'folder', path: '/workspace/alpha' },
          { id: '/workspace/beta', name: 'beta', type: 'folder', path: '/workspace/beta', children: [] },
        ],
      },
    ];

    const dispose = render(() => {
      const [tree, setTree] = createSignal(treeBefore);
      const [currentPath, setCurrentPath] = createSignal('/workspace/alpha/one');
      const [pendingPath, setPendingPath] = createSignal('');

      return (
        <LayoutProvider>
          <div class="h-[560px]">
            <FileBrowserWorkspace
              mode="files"
              onModeChange={() => {}}
              files={tree()}
              currentPath={currentPath()}
              pendingNavigationPath={pendingPath()}
              initialPath="/workspace/alpha/one"
              persistenceKey="test-files-workspace-click-anchor-bottom"
              instanceId="test-files-workspace-click-anchor-bottom"
              resetKey={0}
              width={260}
              open
              onNavigate={(path) => {
                setPendingPath(path);
                window.setTimeout(() => {
                  setTree(treeAfter);
                  setCurrentPath(path);
                  const nextBetaRow = host.querySelector('[data-tree-row-path="/workspace/beta"]') as HTMLElement | null;
                  if (nextBetaRow) {
                    mockElementRect(nextBetaRow, {
                      left: 0,
                      top: 300,
                      right: 240,
                      bottom: 320,
                      width: 240,
                      height: 20,
                    });
                  }
                  setPendingPath('');
                }, 0);
              }}
            />
          </div>
        </LayoutProvider>
      );
    }, host);

    try {
      await flush();

      const scrollRegion = host.querySelector('[data-testid="file-tree-scroll-region"]') as HTMLElement | null;
      expect(scrollRegion).toBeTruthy();
      mockScrollGeometry(scrollRegion!, {
        top: 100,
        clientHeight: 300,
        scrollHeight: 900,
        scrollTop: 580,
      });

      const betaRow = host.querySelector('[data-tree-row-path="/workspace/beta"]') as HTMLElement | null;
      expect(betaRow).toBeTruthy();
      mockElementRect(betaRow!, {
        left: 0,
        top: 240,
        right: 240,
        bottom: 260,
        width: 240,
        height: 20,
      });

      betaRow!.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        clientY: 250,
        detail: 1,
      }));

      await flush();
      await flush();

      expect(scrollRegion!.scrollTop).toBe(600);
    } finally {
      dispose();
    }
  });

  it('marks both sidebar tree rows and main file items as touch-selection-guarded targets', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            files={files}
            currentPath="/"
            initialPath="/"
            persistenceKey="test-files-workspace-touch-guard"
            instanceId="test-files-workspace-touch-guard"
            resetKey={0}
            width={260}
            open
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const sidebarTreeRow = host.querySelector('[data-tree-row-path="/src"]');
      const readmeButton = Array.from(host.querySelectorAll('button'))
        .find((node) => node.textContent?.includes('README.md'));

      expect(sidebarTreeRow?.getAttribute('data-file-browser-touch-target')).toBe('true');
      expect(readmeButton?.getAttribute('data-file-browser-touch-target')).toBe('true');
    } finally {
      dispose();
    }
  });

  it('remounts the file browser provider when resetKey changes', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let setResetKey!: (value: number) => void;

    const dispose = render(() => {
      const [resetKey, updateResetKey] = createSignal(0);
      setResetKey = updateResetKey;

      return (
        <LayoutProvider>
          <div class="h-[560px]">
            <FileBrowserWorkspace
              mode="files"
              onModeChange={() => {}}
              files={files}
              currentPath="/"
              initialPath="/"
              persistenceKey="test-files-workspace-reset-key"
              instanceId="test-files-workspace-reset-key"
              resetKey={resetKey()}
              width={260}
              open
            />
          </div>
        </LayoutProvider>
      );
    }, host);

    try {
      const filterInput = host.querySelector('input[aria-label="Filter files"]') as HTMLInputElement | null;
      expect(filterInput).toBeTruthy();
      filterInput!.value = 'README';
      filterInput!.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
      expect(filterInput!.value).toBe('README');

      setResetKey(1);
      await Promise.resolve();
      await Promise.resolve();

      const nextFilterInput = host.querySelector('input[aria-label="Filter files"]') as HTMLInputElement | null;
      expect(nextFilterInput).toBeTruthy();
      expect(nextFilterInput).not.toBe(filterInput);
      expect(nextFilterInput!.value).toBe('');
    } finally {
      dispose();
    }
  });

  it('renders published code badges for representative code files in the agent workspace', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const codeFiles: FileItem[] = [
      { id: 'file-eslint-config', name: 'eslint.config.mjs', type: 'file', path: '/eslint.config.mjs' },
      { id: 'file-server-ts', name: 'server.ts', type: 'file', path: '/server.ts' },
      { id: 'file-dockerfile', name: 'Dockerfile', type: 'file', path: '/Dockerfile' },
      { id: 'file-dockerfile-prefix', name: 'Dockerfile.dev', type: 'file', path: '/Dockerfile.dev' },
      { id: 'file-dockerfile-suffix', name: 'deploy.dockerfile', type: 'file', path: '/deploy.dockerfile' },
      { id: 'file-makefile', name: 'Makefile', type: 'file', path: '/Makefile' },
      { id: 'file-cmake', name: 'CMakeLists.txt', type: 'file', path: '/CMakeLists.txt' },
      { id: 'file-zshrc', name: '.zshrc', type: 'file', path: '/.zshrc' },
      { id: 'file-powershell', name: 'deploy.ps1', type: 'file', path: '/deploy.ps1' },
      { id: 'file-gradle', name: 'build.gradle', type: 'file', path: '/build.gradle' },
    ];

    const dispose = render(() => (
      <LayoutProvider>
        <div style={{ height: '1200px', width: '960px' }}>
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            files={codeFiles}
            currentPath="/"
            initialPath="/"
            persistenceKey="test-files-workspace-code-icons"
            instanceId="test-files-workspace-code-icons"
            resetKey={0}
            width={260}
            open
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      const listButton = Array.from(host.querySelectorAll('button'))
        .find((node) => node.textContent === 'List');
      expect(listButton).toBeTruthy();
      listButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      const expectations = [
        ['eslint.config.mjs', 'JS', 'warning'],
        ['server.ts', 'TS', 'primary'],
        ['Dockerfile', 'DKR', 'info'],
        ['Dockerfile.dev', 'DKR', 'info'],
        ['deploy.dockerfile', 'DKR', 'info'],
        ['Makefile', 'MAKE', 'warning'],
        ['CMakeLists.txt', 'CMK', 'primary'],
        ['.zshrc', 'SH', 'success'],
        ['deploy.ps1', 'PS', 'primary'],
        ['build.gradle', 'GRV', 'success'],
      ] as const;

      for (const [fileName, label, tone] of expectations) {
        expectCodeBadgeForFile(host, fileName, label, tone);
      }
    } finally {
      dispose();
    }
  });

  it('expands deep ancestors and summarizes long current paths without breaking sidebar scrolling', async () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <FileBrowserWorkspace
            mode="files"
            onModeChange={() => {}}
            files={buildDeepFolderTree()}
            currentPath="/workspace/customer-facing-platform/services/really-long-nested-feature/config/runtime/assets/icons"
            initialPath="/workspace/customer-facing-platform/services/really-long-nested-feature/config/runtime/assets/icons"
            persistenceKey="test-files-workspace-deep"
            instanceId="test-files-workspace-deep"
            resetKey={0}
            width={260}
            open
          />
        </div>
      </LayoutProvider>
    ), host);

    try {
      await Promise.resolve();
      const activeRow = host.querySelector('[data-tree-row-path="/workspace/customer-facing-platform/services/really-long-nested-feature/config/runtime/assets/icons"]');
      expect(activeRow).toBeTruthy();
      expect(activeRow?.textContent).toContain('icons');
      expect(host.textContent).toContain('+2');
      expect(scrollIntoView).toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('maps absolute reveal requests through the workspace shell, clears blocking filters, and shows the created item as selected', async () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const consumed = vi.fn();
    let setRevealRequest!: (request: FileBrowserRevealRequest | null) => void;

    const host = document.createElement('div');
    document.body.appendChild(host);

    const absoluteFiles: FileItem[] = [
      {
        id: '/workspace/src',
        name: 'src',
        type: 'folder',
        path: '/workspace/src',
        children: [
          { id: '/workspace/src/current.txt', name: 'current.txt', type: 'file', path: '/workspace/src/current.txt' },
          { id: '/workspace/src/fresh.txt', name: 'fresh.txt', type: 'file', path: '/workspace/src/fresh.txt' },
        ],
      },
    ];

    function Harness() {
      const [revealRequest, updateRevealRequest] = createSignal<FileBrowserRevealRequest | null>(null);
      setRevealRequest = updateRevealRequest;

      return (
        <FileBrowserWorkspace
          mode="files"
          onModeChange={() => {}}
          files={absoluteFiles}
          currentPath="/workspace/src"
          initialPath="/workspace/src"
          homePath="/workspace"
          persistenceKey="test-files-workspace-reveal"
          instanceId="test-files-workspace-reveal"
          resetKey={0}
          width={260}
          open
          revealRequest={revealRequest()}
          onRevealRequestConsumed={(requestId) => {
            consumed(requestId);
            updateRevealRequest(null);
          }}
        />
      );
    }

    const dispose = render(() => (
      <LayoutProvider>
        <div class="h-[560px]">
          <Harness />
        </div>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const filterInput = host.querySelector('input[aria-label="Filter files"]') as HTMLInputElement | null;
      expect(filterInput).toBeTruthy();

      filterInput!.value = 'current';
      filterInput!.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'current' }));
      await flush();
      await flush();

      expect(filterInput!.value).toBe('current');
      expect(host.textContent).toContain('Filter active');
      expect(host.textContent).not.toContain('fresh.txt');

      setRevealRequest({
        requestId: 'created-entry-1',
        targetId: '/workspace/src/fresh.txt',
        targetPath: '/workspace/src/fresh.txt',
        parentPath: '/workspace/src',
        clearFilter: 'if-needed',
      });
      await flush();
      await flush();
      await flush();

      expect(host.textContent).not.toContain('Filter active');
      expect(scrollIntoView).toHaveBeenCalled();
      expect(host.textContent).toContain('fresh.txt');
      expect(host.textContent).toContain('1 selected');
      expect(consumed).toHaveBeenCalledWith('created-entry-1');
    } finally {
      dispose();
    }
  });
});
