import type { JSX } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'solid-js/web';

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Dialog: (props: {
    children?: JSX.Element;
    class?: string;
    footer?: JSX.Element;
    onOpenChange?: (open: boolean) => void;
    open?: boolean;
    title?: string;
  }) => (
    <div
      data-dialog="true"
      data-open={props.open ? 'true' : 'false'}
      data-dialog-class={props.class}
    >
      <div data-dialog-title>{props.title}</div>
      <div data-dialog-body>{props.children}</div>
      <div data-dialog-footer>{props.footer}</div>
      <button type="button" data-dialog-close onClick={() => props.onOpenChange?.(false)}>close</button>
    </div>
  ),
  Button: (props: {
    children?: JSX.Element;
    class?: string;
    onClick?: () => void;
    type?: 'button';
  }) => (
    <button
      type={props.type ?? 'button'}
      class={props.class}
      data-button="true"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  ),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  AlertTriangle: (props: { class?: string }) => <svg class={props.class} data-icon="alert-triangle" />,
}));

describe('DesktopConfirmationApp', () => {
  it('renders the warning inside the shared dialog structure', async () => {
    const { DesktopConfirmationApp } = await import('./App');

    const html = renderToString(() => (
      <DesktopConfirmationApp
        model={{
          title: 'Quit Redeven Desktop?',
          message: 'This will stop 1 Desktop-managed runtime.',
          detail: '1 externally managed runtime will keep running.',
          confirm_label: 'Quit',
          cancel_label: 'Cancel',
          confirm_tone: 'danger',
        }}
      />
    ));

    expect(html).toContain('class="redeven-confirmation-window"');
    expect(html).toContain('data-dialog="true"');
    expect(html).toContain('data-dialog-class="redeven-confirmation-dialog w-[min(26rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)]"');
    expect(html).toContain('data-dialog-title');
    expect(html).toContain('data-dialog-footer');
    expect(html).toContain('redeven-confirmation-body');
    expect(html).toContain('data-icon="alert-triangle"');
  });
});
