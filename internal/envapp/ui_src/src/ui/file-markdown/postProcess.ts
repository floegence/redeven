export function postProcess(root: HTMLElement): void {
  attachCodeCopyHandlers(root);
  protectExternalLinks(root);
}

function attachCodeCopyHandlers(root: HTMLElement): void {
  const buttons = root.querySelectorAll<HTMLElement>('.fm-code-copy');
  for (const btn of buttons) {
    btn.addEventListener('click', async () => {
      const encoded = btn.getAttribute('data-code');
      if (!encoded) return;
      const code = decodeURIComponent(encoded);
      try {
        await navigator.clipboard.writeText(code);
        btn.classList.add('fm-copied');
        setTimeout(() => btn.classList.remove('fm-copied'), 1500);
      } catch {
        // Clipboard API not available
      }
    });
  }
}

function protectExternalLinks(root: HTMLElement): void {
  const links = root.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]');
  for (const link of links) {
    if (!link.getAttribute('rel')) {
      link.setAttribute('rel', 'noopener noreferrer');
    }
  }
}
