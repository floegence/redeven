import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'solid-js/web';

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: {
    children?: string;
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
  it('renders a single-sheet confirmation layout instead of nesting a dialog inside the window', async () => {
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
    expect(html).toContain('class="redeven-confirmation-sheet"');
    expect(html).toContain('redeven-confirmation-header');
    expect(html).toContain('redeven-confirmation-footer');
    expect(html).toContain('aria-label="Cancel confirmation"');
    expect(html).not.toContain('dialog-content');
    expect(html).not.toContain('data-slot="dialog');
  });
});
