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
}));

vi.mock('@floegence/floe-webapp-core/loading', () => ({
  LoadingOverlay: (props: any) => (props.visible ? <div>{props.message}</div> : null),
}));

afterEach(() => {
  document.body.innerHTML = '';
  layoutState.mobile = false;
  vi.restoreAllMocks();
});

describe('FilePreviewSurface', () => {
  it('renders a floating window on desktop and forwards the current preview selection to Ask Flower', () => {
    const onAskFlower = vi.fn();
    const onDownload = vi.fn();

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FilePreviewSurface
        open
        onOpenChange={() => undefined}
        item={{ id: '/workspace/demo.txt', name: 'demo.txt', path: '/workspace/demo.txt', type: 'file' }}
        mode="text"
        text="selected line"
        onAskFlower={onAskFlower}
        onDownload={onDownload}
      />
    ), host);

    expect(host.querySelector('[data-testid="floating-window"]')).toBeTruthy();

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

  it('renders a dialog shell on mobile and keeps the preview message visible', () => {
    layoutState.mobile = true;

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FilePreviewSurface
        open
        onOpenChange={() => undefined}
        item={{ id: '/workspace/demo.pdf', name: 'demo.pdf', path: '/workspace/demo.pdf', type: 'file' }}
        mode="unsupported"
        message="This file is too large to preview."
        truncated
      />
    ), host);

    const dialog = host.querySelector('[data-testid="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.className).toContain('h-[calc(100dvh-0.5rem)]');
    expect(host.textContent).toContain('/workspace/demo.pdf');
    expect(host.textContent).toContain('Truncated preview');
    expect(host.textContent).toContain('This file is too large to preview.');
  });
});
