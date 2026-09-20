// @vitest-environment jsdom
import { beforeEach, vi } from 'vitest';
import './FileBrowserWorkspace.paths.test.shared';

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((media: string) => ({
      matches: false, media, onchange: null,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {}, dispatchEvent: () => false,
    })),
  });
});
