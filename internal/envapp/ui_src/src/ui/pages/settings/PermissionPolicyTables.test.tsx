// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PermissionMatrixTable, PermissionRuleTable } from './PermissionPolicyTables';

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
  Checkbox: (props: any) => (
    <input
      type="checkbox"
      checked={!!props.checked}
      disabled={props.disabled}
      aria-label={props.label || 'checkbox'}
      onChange={(event) => props.onChange?.((event.currentTarget as HTMLInputElement).checked)}
    />
  ),
  Input: (props: any) => (
    <input
      type={props.type ?? 'text'}
      value={props.value ?? ''}
      placeholder={props.placeholder}
      disabled={props.disabled}
      onInput={props.onInput}
    />
  ),
}));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('PermissionPolicyTables', () => {
  it('shows permission state and emits matrix changes', () => {
    const onChange = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <PermissionMatrixTable read write={false} execute canInteract onChange={onChange} />, host);

    const toggles = host.querySelectorAll('input[type="checkbox"]');
    const writeToggle = toggles[1] as HTMLInputElement;
    writeToggle.checked = true;
    writeToggle.dispatchEvent(new Event('change', { bubbles: true }));

    expect(host.textContent).toContain('Enabled');
    expect(host.textContent).toContain('Disabled');
    expect(onChange).toHaveBeenCalledWith('write', true);
  });

  it('renders editable rule rows and empty state messaging', () => {
    const onChangeKey = vi.fn();
    const onChangePerm = vi.fn();
    const onRemove = vi.fn();

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(
      () => (
        <>
          <PermissionRuleTable
            rows={[
              {
                key: 'user_123',
                read: true,
                write: false,
                execute: false,
              },
            ]}
            emptyMessage="No rows"
            keyHeader="User"
            keyPlaceholder="user_public_id"
            canInteract
            readEnabled
            writeEnabled
            executeEnabled
            onChangeKey={onChangeKey}
            onChangePerm={onChangePerm}
            onRemove={onRemove}
          />
          <PermissionRuleTable
            rows={[]}
            emptyMessage="No rows"
            keyHeader="App"
            keyPlaceholder="app_id"
            canInteract
            readEnabled
            writeEnabled
            executeEnabled
            onChangeKey={() => undefined}
            onChangePerm={() => undefined}
            onRemove={() => undefined}
          />
        </>
      ),
      host,
    );

    const input = host.querySelector('input[placeholder="user_public_id"]') as HTMLInputElement;
    input.value = 'user_456';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const firstRowToggle = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    firstRowToggle.checked = false;
    firstRowToggle.dispatchEvent(new Event('change', { bubbles: true }));

    const removeButton = Array.from(host.querySelectorAll('button')).find((candidate) => candidate.textContent?.trim() === 'Remove');
    if (!removeButton) throw new Error('Remove button not found');
    removeButton.click();

    expect(onChangeKey).toHaveBeenCalledWith(0, 'user_456');
    expect(onChangePerm).toHaveBeenCalledWith(0, 'read', false);
    expect(onRemove).toHaveBeenCalledWith(0);
    expect(host.textContent).toContain('No rows');
  });
});
