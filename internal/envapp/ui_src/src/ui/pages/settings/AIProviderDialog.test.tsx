// @vitest-environment jsdom

import { Show } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AIProviderDialog } from './AIProviderDialog';
import type { AIProviderDialogProps } from './AIProviderDialog';
import type { AIProviderRow } from './types';

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  createFloatingPresence: (options: { open: () => boolean }) => ({
    mounted: () => Boolean(options.open()),
    exiting: () => false,
    state: () => (options.open() ? 'entered' : 'exited'),
  }),
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
        note_key: 'openai_gpt_54_professional',
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
    onRemoveRecommendedPreset: vi.fn(),
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

function setInputValue(host: HTMLElement, placeholder: string, value: string) {
  const input = Array.from(host.querySelectorAll('input')).find((candidate) => candidate.getAttribute('placeholder') === placeholder) as HTMLInputElement | undefined;
  if (!input) throw new Error(`Input not found: ${placeholder}`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
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
    expect(host.textContent).toContain('Save Provider');
    expect(host.textContent).toContain('OpenAI');
    expect(host.textContent).not.toContain('provider_id');
    expect(host.textContent).not.toContain('Save key');
    expect(host.querySelector('[data-provider-brand="openai"]')).not.toBeNull();
  });

  it('expands a provider type inline and keeps the current type open on repeat click', () => {
    const onChangeType = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(
      () => (
        <AIProviderDialog
          {...makeProps({
            provider: {
              ...baseProvider(),
              type: 'deepseek',
              base_url: 'https://api.deepseek.com',
              models: [
                {
                  model_name: 'deepseek-v4-pro',
                  context_window: 1000000,
                  max_output_tokens: 384000,
                  input_modalities: ['text'],
                },
              ],
            },
            onChangeType,
          })}
        />
      ),
      host,
    );

    clickButton(host, 'DeepSeek');
    expect(host.textContent).toContain('Connection');
    expect(host.textContent).toContain('Recommended Models');

    clickButton(host, 'DeepSeek');
    expect(host.textContent).not.toContain('Base URL');

    expect(onChangeType).not.toHaveBeenCalled();
  });

  it('wires recommended model add/remove and custom model entry through the dialog controls', () => {
    const onAddSelectedPreset = vi.fn();
    const onRemoveRecommendedPreset = vi.fn();
    const onAddCustomModel = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(
      () => (
        <AIProviderDialog
          {...makeProps({
            provider: {
              ...baseProvider(),
              type: 'openai_compatible',
              name: 'Endpoint',
              base_url: 'https://endpoint.example/v1',
              models: [
                {
                  model_name: 'custom-model',
                  context_window: 128000,
                  max_output_tokens: 4096,
                  input_modalities: ['text'],
                },
              ],
            },
            recommendedModels: [
              {
                model_name: 'custom-model',
                context_window: 128000,
                max_output_tokens: 4096,
                input_modalities: ['text'],
                note_key: 'openai_gpt_5_stable',
              },
              {
                model_name: 'preset-model',
                context_window: 128000,
                max_output_tokens: 4096,
                input_modalities: ['text', 'image'],
              },
            ],
            onAddSelectedPreset,
            onRemoveRecommendedPreset,
            onAddCustomModel,
          })}
        />
      ),
      host,
    );

    clickButton(host, 'OpenAI-compatible');
    clickButton(host, 'Remove');
    expect(onRemoveRecommendedPreset).toHaveBeenCalledWith('custom-model');

    clickButton(host, 'Add');
    expect(onAddSelectedPreset).toHaveBeenCalledWith('preset-model');

    setInputValue(host, 'Custom model name', 'my-custom');
    clickButton(host, 'Add Custom Model');
    expect(onAddCustomModel).toHaveBeenCalledWith('my-custom');
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
              base_url: 'https://endpoint.example/v1',
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

    clickButton(host, 'OpenAI-compatible');
    expect(host.textContent).toContain('Web Search');
    expect(host.textContent).toContain('Brave API Key');
  });
});
