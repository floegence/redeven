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
  Checkbox: (props: any) => (
    <label>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange?.((event.currentTarget as HTMLInputElement).checked)}
      />
      {props.label}
    </label>
  ),
  Dialog: (props: any) => (
    <Show when={props.open}>
      <div data-dialog-class={props.class}>
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
        input_modalities: ['text', 'image'],
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
    webSearchKeySet: false,
    webSearchKeyDraft: '',
    webSearchKeySaving: false,
    recommendedModels: [
      {
        model_name: 'gpt-5.4',
        context_window: 400000,
        max_output_tokens: 128000,
        effective_context_window_percent: 95,
        input_modalities: ['text', 'image'],
        note: 'Latest preset',
      },
    ],
    onOpenChange: vi.fn(),
    onConfirm: vi.fn(),
    onChangeName: vi.fn(),
    onChangeType: vi.fn(),
    onChangeBaseURL: vi.fn(),
    onChangeKeyDraft: vi.fn(),
    onChangeWebSearchMode: vi.fn(),
    onChangeWebSearchKeyDraft: vi.fn(),
    onApplyAllPresets: vi.fn(),
    onAddSelectedPreset: vi.fn(),
    onAddCustomModel: vi.fn(),
    onChangeModelName: vi.fn(),
    onChangeModelNumber: vi.fn(),
    onChangeModelImageInput: vi.fn(),
    onRemoveModel: vi.fn(),
    ...overrides,
  };
}

function clickButton(host: HTMLElement, label: string) {
  const button = Array.from(host.querySelectorAll('button')).find((candidate) => {
    const strongLabel = candidate.querySelector('.text-sm.font-semibold')?.textContent?.trim();
    if (strongLabel === label) return true;
    const text = candidate.textContent?.replace(/\s+/g, ' ').trim();
    return text === label;
  });
  if (!button) throw new Error(`Button not found: ${label}`);
  button.click();
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AIProviderDialog', () => {
  it('renders the provider editor without exposing internal ids in the main path', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <AIProviderDialog {...makeProps()} />, host);

    expect(host.textContent).toContain('Provider Type');
    expect(host.textContent).toContain('Connection');
    expect(host.textContent).toContain('Recommended Models');
    expect(host.textContent).toContain('Enabled Models');
    expect(host.textContent).toContain('Save Provider');
    expect(host.textContent).toContain('Key ready');
    expect(host.textContent).toContain('OpenAI built-in web search');
    expect(host.textContent).not.toContain('provider_id');
    expect(host.textContent).not.toContain('Save key');
    expect(host.querySelector('[data-dialog-class]')?.getAttribute('data-dialog-class')).toContain('w-[min(68rem,96vw)]');
    expect(host.querySelector('[data-dialog-class]')?.getAttribute('data-dialog-class')).toContain('max-w-[96vw]');
  });

  it('wires provider actions through the dialog controls', () => {
    const onChangeType = vi.fn();
    const onApplyAllPresets = vi.fn();
    const onAddSelectedPreset = vi.fn();
    const onAddCustomModel = vi.fn();
    const onConfirm = vi.fn();

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(
      () => (
        <AIProviderDialog
          {...makeProps({
            onChangeType,
            onApplyAllPresets,
            onAddSelectedPreset,
            onAddCustomModel,
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
          })}
        />
      ),
      host,
    );

    clickButton(host, 'Anthropic');

    clickButton(host, 'Use All');
    clickButton(host, 'Use');
    const customInput = Array.from(host.querySelectorAll('input')).find((input) => input.getAttribute('placeholder') === 'Custom model name') as HTMLInputElement;
    customInput.value = 'custom-model';
    customInput.dispatchEvent(new Event('input', { bubbles: true }));
    clickButton(host, 'Add Custom Model');
    clickButton(host, 'Save Provider');

    expect(onChangeType).toHaveBeenCalledWith('anthropic');
    expect(onApplyAllPresets).toHaveBeenCalledOnce();
    expect(onAddSelectedPreset).toHaveBeenCalledWith('gpt-5.4');
    expect(onAddCustomModel).toHaveBeenCalledWith('custom-model');
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('shows web search controls only for openai-compatible providers', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(
      () => (
        <AIProviderDialog
          {...makeProps({
            provider: {
              ...baseProvider(),
              type: 'openai_compatible',
              base_url: 'https://gateway.example/v1',
              web_search: { mode: 'brave' },
            },
            keySet: false,
            webSearchKeySet: true,
            webSearchKeyDraft: 'brave-key',
          })}
        />
      ),
      host,
    );

    expect(host.textContent).not.toContain('Brave API Key');
    clickButton(host, 'Advanced');
    expect(host.textContent).toContain('Web Search');
    expect(host.textContent).toContain('Brave API Key');
    expect(host.textContent).not.toContain('Save Brave key');
    expect(host.textContent).not.toContain('Clear Brave');
  });
});
