// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilePreviewDialog } from './FilePreviewDialog';

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  useLayout: () => ({
    isMobile: () => false,
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
}));

vi.mock('@floegence/floe-webapp-core/loading', () => ({
  LoadingOverlay: (props: any) => (props.visible ? <div>{props.message}</div> : null),
}));

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('FilePreviewDialog', () => {
  it('renders explicit footer actions and forwards the current preview selection to Ask Flower', async () => {
    const onAskFlower = vi.fn();
    const onDownload = vi.fn();

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FilePreviewDialog
        open
        onOpenChange={() => undefined}
        item={{ id: '/workspace/demo.txt', name: 'demo.txt', path: '/workspace/demo.txt', type: 'file' }}
        mode="text"
        text="selected line"
        onAskFlower={onAskFlower}
        onDownload={onDownload}
      />
    ), host);

    const previewTextNode = host.querySelector('pre')?.firstChild as Node | null;
    expect(previewTextNode).toBeTruthy();

    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      toString: () => 'selected line',
      getRangeAt: () => ({ commonAncestorContainer: previewTextNode }) as Range,
    } as unknown as Selection);

    const buttons = Array.from(host.querySelectorAll('button'));
    buttons.find((button) => button.textContent?.includes('Ask Flower'))?.click();
    buttons.find((button) => button.textContent?.includes('Download'))?.click();

    expect(onAskFlower).toHaveBeenCalledWith('selected line');
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('shows path and truncated state in the dialog shell', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FilePreviewDialog
        open
        onOpenChange={() => undefined}
        item={{ id: '/workspace/demo.pdf', name: 'demo.pdf', path: '/workspace/demo.pdf', type: 'file' }}
        mode="unsupported"
        message="This file is too large to preview."
        truncated
      />
    ), host);

    expect(host.textContent).toContain('/workspace/demo.pdf');
    expect(host.textContent).toContain('Truncated preview');
    expect(host.textContent).toContain('This file is too large to preview.');
  });
});
