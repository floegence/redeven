// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { Show } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TerminalGroupEditorDialog, defaultTerminalGroupNameFromPath } from './TerminalGroupDialogs';

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  createFloatingPresence: (options: { open: () => boolean }) => ({
    mounted: () => Boolean(options.open()),
    exiting: () => false,
    state: () => (options.open() ? 'entered' : 'exited'),
  }),
  Button: (props: any) => (
    <button
      type={props.type ?? 'button'}
      class={props.class}
      disabled={props.disabled}
      title={props.title}
      aria-label={props['aria-label']}
      data-testid={props['data-testid']}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  ),
  Dialog: (props: any) => (
    <Show when={props.open}>
      <div data-testid="group-editor-dialog">
        <div>{props.title}</div>
        <div>{props.children}</div>
        <div>{props.footer}</div>
      </div>
    </Show>
  ),
  ConfirmDialog: () => null,
  DirectoryPicker: (props: any) => props.open ? (
    <button data-testid="mock-directory-picker" onClick={() => {
      props.onOpenChange(false);
      props.onSelect('/workspace/services');
    }}>
      {props.title}
    </button>
  ) : null,
}));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('TerminalGroupEditorDialog', () => {
  it('derives a new group name from the selected path until the user edits the name', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onSubmit = vi.fn();
    render(() => (
      <TerminalGroupEditorDialog
        open
        group={null}
        defaultWorkingDir="/Users/demo/projects/redeven"
        onCancel={() => undefined}
        onSubmit={onSubmit}
      />
    ), host);

    const inputs = host.querySelectorAll<HTMLInputElement>('input');
    const nameInput = inputs[0]!;
    const pathInput = host.querySelector<HTMLInputElement>('[data-testid="terminal-group-path-input"]')!;
    expect(nameInput.value).toBe('redeven');

    pathInput.value = '/workspace/backend';
    pathInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(nameInput.value).toBe('backend');

    nameInput.value = 'API';
    nameInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    pathInput.value = '/workspace/frontend';
    pathInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(nameInput.value).toBe('API');
  });

  it('selects the default path through the shared directory picker', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onPickerOpen = vi.fn();
    render(() => (
      <TerminalGroupEditorDialog
        open
        group={null}
        defaultWorkingDir="/Users/demo"
        onPickerOpen={onPickerOpen}
        onCancel={() => undefined}
        onSubmit={() => undefined}
      />
    ), host);

    host.querySelector<HTMLButtonElement>('[data-testid="terminal-group-path-picker-trigger"]')?.click();
    expect(onPickerOpen).toHaveBeenCalledOnce();
    expect(host.querySelector('[data-testid="group-editor-dialog"]')).toBeNull();
    host.querySelector<HTMLButtonElement>('[data-testid="mock-directory-picker"]')?.click();

    expect(host.querySelector('[data-testid="group-editor-dialog"]')).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>('[data-testid="terminal-group-path-input"]')?.value).toBe('/workspace/services');
    expect(host.querySelectorAll<HTMLInputElement>('input')[0]?.value).toBe('services');
  });

  it('normalizes trailing separators when deriving a name', () => {
    expect(defaultTerminalGroupNameFromPath('/workspace/services///')).toBe('services');
    expect(defaultTerminalGroupNameFromPath('C:\\workspace\\client\\')).toBe('client');
    expect(defaultTerminalGroupNameFromPath('/')).toBe('/');
  });
});
