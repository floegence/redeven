// @vitest-environment jsdom

import { LayoutProvider } from '@floegence/floe-webapp-core';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileBrowserWorkspace } from './FileBrowserWorkspace';

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })),
  });

  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('FileBrowserWorkspace interactions', () => {
  it('keeps the Files/Git mode switch pinned in the shared sidebar shell', () => {
    let nextMode = '';
    const host = document.createElement('div');
    document.body.appendChild(host);

    const files: FileItem[] = [
      { id: 'folder-src', name: 'src', type: 'folder', path: '/src', children: [] },
      { id: 'file-readme', name: 'README.md', type: 'file', path: '/README.md' },
    ];

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
});
