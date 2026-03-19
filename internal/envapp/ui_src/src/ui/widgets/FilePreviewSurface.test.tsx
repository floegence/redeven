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

vi.mock('@floegence/floe-webapp-core/ui', () => ({
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
        <div>{props.title}</div>
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
}));

vi.mock('./FilePreviewContent', () => ({
  FilePreviewContent: (props: any) => (
    <div ref={(element) => props.contentRef?.(element)}>
      <div>{props.item?.path}</div>
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
        selectedText="selected from editor"
        onAskFlower={onAskFlower}
        onDownload={onDownload}
      />
    ), host);

    expect(host.querySelector('[data-testid="floating-window"]')).toBeTruthy();

    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      toString: () => 'selected from dom',
      getRangeAt: () => ({ commonAncestorContainer: host.querySelector('pre')?.firstChild as Node }) as Range,
    } as unknown as Selection);

    const buttons = Array.from(host.querySelectorAll('button'));
    buttons.find((button) => button.textContent?.includes('Ask Flower'))?.click();
    buttons.find((button) => button.textContent?.includes('Download'))?.click();

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
        closeConfirmOpen
        closeConfirmMessage="Discard unsaved changes in demo.pdf and close the preview?"
      />
    ), host);

    const dialog = host.querySelector('[data-testid="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.className).toContain('h-[calc(100dvh-0.5rem)]');
    expect(host.textContent).toContain('/workspace/demo.pdf');
    expect(host.textContent).toContain('Truncated preview');
    expect(host.textContent).toContain('This file is too large to preview.');
    expect(host.querySelector('[data-testid="confirm-dialog"]')).toBeTruthy();
  });
});
