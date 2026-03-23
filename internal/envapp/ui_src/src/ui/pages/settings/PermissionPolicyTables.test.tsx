// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
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
  Tag: (props: any) => <span class={props.class}>{props.children}</span>,
}));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('PermissionPolicyTables', () => {
  it('reacts to parent state updates and emits matrix changes', () => {
    const onChange = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    let setWrite = (_value: boolean) => undefined;
    let setExecute = (_value: boolean) => undefined;

    render(() => {
      const [read, setRead] = createSignal(true);
      const [write, updateWrite] = createSignal(false);
      const [execute, updateExecute] = createSignal(true);
      setWrite = updateWrite;
      setExecute = updateExecute;

      return (
        <PermissionMatrixTable
          read={read()}
          write={write()}
          execute={execute()}
          canInteract
          onChange={(key, value) => {
            onChange(key, value);
            if (key === 'read') setRead(value);
            if (key === 'write') setWrite(value);
            if (key === 'execute') setExecute(value);
          }}
        />
      );
    }, host);

    const countPills = (label: 'Enabled' | 'Disabled') => (host.textContent?.match(new RegExp(label, 'g')) ?? []).length;

    expect(countPills('Enabled')).toBe(2);
    expect(countPills('Disabled')).toBe(1);

    setWrite(true);
    expect(countPills('Enabled')).toBe(3);
    expect(countPills('Disabled')).toBe(0);

    setExecute(false);
    expect(countPills('Enabled')).toBe(2);
    expect(countPills('Disabled')).toBe(1);

    const toggles = host.querySelectorAll('input[type="checkbox"]');
    const readToggle = toggles[0] as HTMLInputElement;
    readToggle.checked = false;
    readToggle.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange).toHaveBeenCalledWith('read', false);
    expect(countPills('Enabled')).toBe(1);
    expect(countPills('Disabled')).toBe(2);
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

  it('keeps focus on a new rule input while the parent updates that row', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => {
      const [rows, setRows] = createSignal([
        {
          key: '',
          read: true,
          write: false,
          execute: false,
        },
      ]);

      return (
        <PermissionRuleTable
          rows={rows()}
          emptyMessage="No rows"
          keyHeader="User"
          keyPlaceholder="user_public_id"
          canInteract
          readEnabled
          writeEnabled
          executeEnabled
          onChangeKey={(index, value) => {
            setRows((prev) => prev.map((item, rowIndex) => (rowIndex === index ? { ...item, key: value } : item)));
          }}
          onChangePerm={(index, key, value) => {
            setRows((prev) => prev.map((item, rowIndex) => (rowIndex === index ? { ...item, [key]: value } : item)));
          }}
          onRemove={(index) => {
            setRows((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
          }}
        />
      );
    }, host);

    const input = host.querySelector('input[placeholder="user_public_id"]') as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    input.value = 'u';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const nextInput = host.querySelector('input[placeholder="user_public_id"]') as HTMLInputElement;
    expect(nextInput).toBe(input);
    expect(nextInput.value).toBe('u');
    expect(document.activeElement).toBe(input);
  });
});
