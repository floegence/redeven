// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilePreviewSurface } from './FilePreviewSurface';

const layoutState = vi.hoisted(() => ({
  mobile: false,
}));

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  useLayout: () => ({
    isMobile: () => layoutState.mobile,
  }),
}));

vi.mock('@floegence/floe-webapp-core/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@floegence/floe-webapp-core/ui')>();
  return {
    ...actual,
    Button: (props: any) => (
      <button
        type="button"
        class={props.class}
        disabled={props.disabled}
        onClick={props.onClick}
      >
        {props.children}
      </button>
    ),
    Dialog: (props: any) => (
      props.open ? (
        <div data-testid="dialog" class={props.class}>
          <div>{props.title}</div>
          <div>{props.children}</div>
          <div>{props.footer}</div>
        </div>
      ) : null
    ),
    FloatingWindow: (props: any) => (
      props.open ? (
        <div data-testid="floating-window" class={props.class}>
          <div data-testid="floating-titlebar">{props.title}{props.headerActions}</div>
          <div>{props.children}</div>
          <div>{props.footer}</div>
        </div>
      ) : null
    ),
    ConfirmDialog: (props: any) => (
      props.open ? (
        <div data-testid="confirm-dialog">
          <div>{props.title}</div>
          <div>{props.description}</div>
        </div>
      ) : null
    ),
  };
});

vi.mock('../file-preview/rendererRegistry', () => ({
  renderRedevenFilePreviewBody: (props: any) => (
    <div data-surface={props.surface ?? 'main'}>
      <pre>{props.text}</pre>
      <div>{props.message}</div>
    </div>
  ),
}));

afterEach(() => {
  document.body.innerHTML = '';
  layoutState.mobile = false;
  vi.restoreAllMocks();
});

describe('FilePreviewSurface', () => {
  it('places one set of file actions in the desktop titlebar and removes the path row', async () => {
    const onCopyPath = vi.fn(async () => true);
    const onStartEdit = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => (
      <FilePreviewSurface
        open
        onOpenChange={() => undefined}
        item={{ id: '/workspace/demo.md', name: 'demo.md', path: '/workspace/demo.md', type: 'file' }}
        descriptor={{ mode: 'markdown' }}
        text="Document content"
        canEdit
        onCopyPath={onCopyPath}
        onStartEdit={onStartEdit}
        onAskFlower={() => undefined}
        onDownload={() => undefined}
      />
    ), host);
    try {
      const titlebar = host.querySelector('[data-testid="floating-titlebar"]')!;
      expect(Array.from(titlebar.querySelectorAll('button')).map((button) => button.getAttribute('aria-label')))
        .toEqual(['Copy path', 'Edit file', 'Ask Flower', 'Download file']);
      expect(host.querySelector('.redeven-file-preview-toolbar')).toBeNull();
      expect(host.textContent).not.toContain('/workspace/demo.md');
      expect(host.querySelectorAll('button[aria-label="Download file"]')).toHaveLength(1);
      (titlebar.querySelector('button[aria-label="Copy path"]') as HTMLButtonElement).click();
      await Promise.resolve();
      expect(onCopyPath).toHaveBeenCalledOnce();
      expect(titlebar.querySelector('button[aria-label="Path copied"]')).toBeTruthy();
      (titlebar.querySelector('button[aria-label="Edit file"]') as HTMLButtonElement).click();
      expect(onStartEdit).toHaveBeenCalledOnce();
      expect(host.textContent).toContain('Document content');
    } finally {
      dispose();
    }
  });

  it('renders a floating window on desktop and prioritizes the editor selection for Ask Flower', () => {
    const onAskFlower = vi.fn();
    const onDownload = vi.fn();

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FilePreviewSurface
        open
        onOpenChange={() => undefined}
        item={{ id: '/workspace/demo.txt', name: 'demo.txt', path: '/workspace/demo.txt', type: 'file' }}
        descriptor={{ mode: 'text', textPresentation: 'plain', wrapText: true }}
        text="selected line"
        editing
        selectedText="selected from editor"
        onAskFlower={onAskFlower}
        onDownload={onDownload}
      />
    ), host);

    expect(host.querySelector('[data-testid="floating-window"]')).toBeTruthy();
    expect(host.querySelector('[data-surface="window"]')).toBeTruthy();
    expect((host.querySelector('[data-testid="floating-window"]') as HTMLElement | null)?.className).not.toContain('[&>div>div:last-child]');
    expect(host.querySelector('[data-testid="file-preview-footer"]')).toBeNull();
    expect(host.textContent).not.toContain('Editing');
    expect(host.textContent).not.toContain('No local changes');

    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      toString: () => 'selected from dom',
      getRangeAt: () => ({ commonAncestorContainer: host.querySelector('pre')?.firstChild as Node }) as Range,
    } as unknown as Selection);

    (host.querySelector('button[aria-label="Ask Flower"]') as HTMLButtonElement | null)?.click();
    (host.querySelector('button[aria-label="Download file"]') as HTMLButtonElement | null)?.click();

    expect(onAskFlower).toHaveBeenCalledWith('selected from editor');
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('renders a dialog shell on mobile, keeps the preview message visible, and shows close confirmation state', () => {
    layoutState.mobile = true;

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FilePreviewSurface
        open
        onOpenChange={() => undefined}
        item={{ id: '/workspace/demo.pdf', name: 'demo.pdf', path: '/workspace/demo.pdf', type: 'file' }}
        descriptor={{ mode: 'unsupported' }}
        message="This file is too large to preview."
        truncated
        onAskFlower={() => undefined}
        onDownload={() => undefined}
        closeConfirmOpen
        closeConfirmMessage="Discard unsaved changes in demo.pdf and close the preview?"
      />
    ), host);

    const dialog = host.querySelector('[data-testid="dialog"]');
    expect(dialog).toBeTruthy();
    expect(host.querySelector('[data-surface="main"]')).toBeTruthy();
    expect(dialog?.className).toContain('h-[calc(100dvh-0.5rem)]');
    expect(dialog?.className).not.toContain('[&>div:last-child]');
    expect(host.textContent).toContain('/workspace/demo.pdf');
    expect(host.querySelector('[data-testid="file-preview-footer"]')).toBeNull();
    expect(host.textContent).not.toContain('Truncated preview');
    expect(host.querySelector('button[aria-label="Ask Flower"]')).toBeTruthy();
    expect(host.querySelector('button[aria-label="Download file"]')).toBeTruthy();
    expect(host.textContent).toContain('This file is too large to preview.');
    expect(host.querySelector('[data-testid="confirm-dialog"]')).toBeTruthy();
  });

  it('renders discard confirmation inside the desktop floating host instead of a global confirm dialog', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FilePreviewSurface
        open
        onOpenChange={() => undefined}
        item={{ id: '/workspace/demo.txt', name: 'demo.txt', path: '/workspace/demo.txt', type: 'file' }}
        descriptor={{ mode: 'text', textPresentation: 'plain', wrapText: true }}
        text="draft"
        editing
        dirty
        closeConfirmOpen
        closeConfirmMessage="Discard local edits in demo.txt and close the preview?"
        onCloseConfirmChange={() => undefined}
        onConfirmDiscardClose={() => undefined}
      />
    ), host);

    await Promise.resolve();

    expect(host.querySelector('[data-testid="confirm-dialog"]')).toBeNull();
    const floatingWindow = host.querySelector('[data-testid="floating-window"]') as HTMLDivElement | null;
    expect(floatingWindow).toBeTruthy();
    expect(floatingWindow?.querySelector('[role="dialog"]')?.textContent).toContain('Discard unsaved changes?');
    expect(floatingWindow?.textContent).toContain('Discard local edits in demo.txt and close the preview?');
  });
});
