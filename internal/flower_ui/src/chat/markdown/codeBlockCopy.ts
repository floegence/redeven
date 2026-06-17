export type FlowerMarkdownCodeCopyLabels = Readonly<{
  copy: string;
  copied: string;
}>;

export type FlowerMarkdownCodeCopyIconMount = (button: HTMLButtonElement) => void;

export function applyFlowerMarkdownCodeCopyLabel(
  button: HTMLButtonElement,
  labels: FlowerMarkdownCodeCopyLabels,
): void {
  const copied = button.dataset.copied === 'true';
  const label = copied ? labels.copied : labels.copy;
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
}

function createFlowerMarkdownCodeCopyButton(
  labels: FlowerMarkdownCodeCopyLabels,
  mountIcons: FlowerMarkdownCodeCopyIconMount,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'flower-chat-md-code-copy';
  applyFlowerMarkdownCodeCopyLabel(button, labels);
  mountIcons(button);
  return button;
}

export function decorateFlowerMarkdownCodeBlocks(
  root: ParentNode,
  labels: FlowerMarkdownCodeCopyLabels,
  mountIcons: FlowerMarkdownCodeCopyIconMount,
): readonly HTMLButtonElement[] {
  const buttons: HTMLButtonElement[] = [];
  const blocks = root.querySelectorAll('pre.flower-chat-md-code-block');
  for (const block of Array.from(blocks)) {
    if (!(block instanceof HTMLPreElement)) continue;
    const currentFrame = block.parentElement?.classList.contains('flower-chat-md-code-frame')
      ? block.parentElement
      : null;
    if (currentFrame) {
      const button = currentFrame.querySelector<HTMLButtonElement>('button.flower-chat-md-code-copy')
        ?? currentFrame.appendChild(createFlowerMarkdownCodeCopyButton(labels, mountIcons));
      mountIcons(button);
      applyFlowerMarkdownCodeCopyLabel(button, labels);
      buttons.push(button);
      continue;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'flower-chat-md-code-frame';
    const button = createFlowerMarkdownCodeCopyButton(labels, mountIcons);
    block.replaceWith(wrapper);
    wrapper.appendChild(block);
    wrapper.appendChild(button);
    buttons.push(button);
  }
  return buttons;
}

export function flowerMarkdownCodeTextForCopyButton(button: HTMLButtonElement): string {
  return button.closest('.flower-chat-md-code-frame')?.querySelector('code')?.textContent ?? '';
}
