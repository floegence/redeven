// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import {
  applyFlowerMarkdownCodeCopyLabel,
  decorateFlowerMarkdownCodeBlocks,
  flowerMarkdownCodeTextForCopyButton,
} from './codeBlockCopy';

describe('Flower markdown code block copy helpers', () => {
  it('wraps code blocks with a local copy button', () => {
    const root = document.createElement('div');
    root.innerHTML = '<pre class="flower-chat-md-code-block"><code>const a = 1;</code></pre>';
    const mountIcons = vi.fn();

    const buttons = decorateFlowerMarkdownCodeBlocks(root, {
      copy: 'Copy code',
      copied: 'Copied',
    }, mountIcons);

    expect(buttons).toHaveLength(1);
    expect(root.querySelector('.flower-chat-md-code-frame')).not.toBeNull();
    expect(root.querySelector('button.flower-chat-md-code-copy')?.getAttribute('aria-label')).toBe('Copy code');
    expect(mountIcons).toHaveBeenCalledTimes(1);
  });

  it('extracts only code text from a copy button', () => {
    const root = document.createElement('div');
    root.innerHTML = '<pre class="flower-chat-md-code-block"><code>const secret = 1;</code></pre>';
    const [button] = decorateFlowerMarkdownCodeBlocks(root, {
      copy: 'Copy code',
      copied: 'Copied',
    }, () => {});

    expect(button).not.toBeUndefined();
    expect(flowerMarkdownCodeTextForCopyButton(button as HTMLButtonElement)).toBe('const secret = 1;');
  });

  it('updates the copy button label for copied state', () => {
    const button = document.createElement('button');

    applyFlowerMarkdownCodeCopyLabel(button, { copy: 'Copy code', copied: 'Copied' });
    expect(button.getAttribute('aria-label')).toBe('Copy code');

    button.dataset.copied = 'true';
    applyFlowerMarkdownCodeCopyLabel(button, { copy: 'Copy code', copied: 'Copied' });
    expect(button.getAttribute('aria-label')).toBe('Copied');
  });
});
