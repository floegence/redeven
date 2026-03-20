// @vitest-environment jsdom

import { LayoutProvider } from '@floegence/floe-webapp-core';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileBrowserWorkspace } from './FileBrowserWorkspace';

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

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    return window.setTimeout(() => callback(performance.now()), 0);
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
    window.clearTimeout(handle);
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

  it('requires in-component focus before routing typing when used as a deck widget surface', async () => {
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
      expect(breadcrumb?.parentElement?.className).toContain('h-7');
      expect(filterInput?.parentElement?.className).toContain('h-7');
      expect(viewSwitcher?.className).toContain('h-7');
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
});
