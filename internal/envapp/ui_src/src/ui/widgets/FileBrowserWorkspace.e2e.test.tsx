// @vitest-environment jsdom

import { LayoutProvider } from '@floegence/floe-webapp-core';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileBrowserWorkspace } from './FileBrowserWorkspace';

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
