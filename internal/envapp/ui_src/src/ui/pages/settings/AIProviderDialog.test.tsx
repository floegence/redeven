// @vitest-environment jsdom

import { Show } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AIProviderDialog } from './AIProviderDialog';
import type { AIProviderDialogProps } from './AIProviderDialog';
import type { AIProviderRow } from './types';

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
  Dialog: (props: any) => (
    <Show when={props.open}>
      <div>
        <div>{props.title}</div>
        <div>{props.children}</div>
        <div>{props.footer}</div>
      </div>
    </Show>
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
  Select: (props: any) => (
    <select value={props.value ?? ''} disabled={props.disabled} onChange={(event) => props.onChange?.(event.currentTarget.value)}>
      <Show when={props.placeholder}>
        <option value="">{props.placeholder}</option>
      </Show>
      {(props.options ?? []).map((option: { value: string; label: string }) => (
        <option value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
  Tag: (props: any) => <span class={props.class}>{props.children}</span>,
}));

function baseProvider(): AIProviderRow {
  return {
    id: 'prov_openai',
    name: 'OpenAI',
    type: 'openai',
    base_url: 'https://api.openai.com/v1',
    models: [
      {
        model_name: 'gpt-5.2',
        context_window: 400000,
        max_output_tokens: 128000,
        effective_context_window_percent: 95,
      },
    ],
  };
}

function makeProps(overrides: Partial<AIProviderDialogProps> = {}): AIProviderDialogProps {
  return {
    open: true,
    title: 'Edit provider',
    provider: baseProvider(),
    canInteract: true,
    canAdmin: true,
    aiSaving: false,
    disableAISaving: false,
    keySet: true,
    keyDraft: '',
    keySaving: false,
    presetModel: 'gpt-5.4',
    recommendedModels: [
      {
        model_name: 'gpt-5.4',
        context_window: 400000,
        max_output_tokens: 128000,
        effective_context_window_percent: 95,
        note: 'Latest preset',
      },
    ],
    recommendedModelOptions: [{ value: 'gpt-5.4', label: 'gpt-5.4 (ctx 400,000 / max 128,000)' }],
    onOpenChange: vi.fn(),
    onConfirm: vi.fn(),
    onChangeName: vi.fn(),
    onChangeType: vi.fn(),
    onChangeBaseURL: vi.fn(),
    onChangeKeyDraft: vi.fn(),
    onSaveKey: vi.fn(),
    onClearKey: vi.fn(),
    onSetPresetModel: vi.fn(),
    onApplyAllPresets: vi.fn(),
    onAddSelectedPreset: vi.fn(),
    onAddModel: vi.fn(),
    onChangeModelName: vi.fn(),
    onChangeModelNumber: vi.fn(),
    onRemoveModel: vi.fn(),
    ...overrides,
  };
}

function clickButton(host: HTMLElement, label: string) {
  const button = Array.from(host.querySelectorAll('button')).find((candidate) => candidate.textContent?.trim() === label);
  if (!button) throw new Error(`Button not found: ${label}`);
  button.click();
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AIProviderDialog', () => {
  it('renders read-only provider id and derived wire model id', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <AIProviderDialog {...makeProps()} />, host);

    expect(host.textContent).toContain('provider_id');
    expect(host.textContent).toContain('prov_openai');
    expect(host.textContent).toContain('prov_openai/gpt-5.2');
    expect(host.textContent).toContain('ctx 400,000');
    expect(host.textContent).toContain('Key set');
  });

  it('wires provider actions through the dialog controls', () => {
    const onChangeType = vi.fn();
    const onSetPresetModel = vi.fn();
    const onApplyAllPresets = vi.fn();
    const onAddSelectedPreset = vi.fn();
    const onAddModel = vi.fn();
    const onConfirm = vi.fn();

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(
      () => (
        <AIProviderDialog
          {...makeProps({
            onChangeType,
            onSetPresetModel,
            onApplyAllPresets,
            onAddSelectedPreset,
            onAddModel,
            onConfirm,
            recommendedModels: [
              {
                model_name: 'gpt-5.4',
                context_window: 400000,
                max_output_tokens: 128000,
              },
              {
                model_name: 'gpt-5.2-mini',
                context_window: 400000,
                max_output_tokens: 128000,
              },
            ],
            recommendedModelOptions: [
              { value: 'gpt-5.4', label: 'gpt-5.4' },
              { value: 'gpt-5.2-mini', label: 'gpt-5.2-mini' },
            ],
          })}
        />
      ),
      host,
    );

    const selects = host.querySelectorAll('select');
    const typeSelect = selects[0] as HTMLSelectElement;
    const presetSelect = selects[1] as HTMLSelectElement;

    typeSelect.value = 'anthropic';
    typeSelect.dispatchEvent(new Event('change', { bubbles: true }));

    presetSelect.value = 'gpt-5.2-mini';
    presetSelect.dispatchEvent(new Event('change', { bubbles: true }));

    clickButton(host, 'Apply all presets');
    clickButton(host, 'Add selected preset');
    clickButton(host, 'Add Model');
    clickButton(host, 'Confirm');

    expect(onChangeType).toHaveBeenCalledWith('anthropic');
    expect(onSetPresetModel).toHaveBeenCalledWith('gpt-5.2-mini');
    expect(onApplyAllPresets).toHaveBeenCalledOnce();
    expect(onAddSelectedPreset).toHaveBeenCalledOnce();
    expect(onAddModel).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
