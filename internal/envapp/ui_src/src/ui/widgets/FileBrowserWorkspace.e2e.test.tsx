// @vitest-environment jsdom

import { LayoutProvider } from '@floegence/floe-webapp-core';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileBrowserWorkspace } from './FileBrowserWorkspace';

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

beforeEach(() => {
  mockMatchMedia(false);

  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });

  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    writable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
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
