// @vitest-environment jsdom
import { Show, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowerProviderDialog } from '../../../../../../flower_ui/src/settings/FlowerProviderDialog';
import { defaultFlowerProviderModels, resolveFlowerProviderModels, serializeFlowerProvider } from '../../../../../../flower_ui/src/settings/modelSelection';
import type { FlowerProviderDraft, FlowerModelCatalogDiscovery } from '../../../../../../flower_ui/src/contracts/flowerSurfaceContracts';

vi.mock('@floegence/floe-webapp-core/ui', async (original) => ({
  ...await original<typeof import('@floegence/floe-webapp-core/ui')>(),
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


afterEach(() => { document.body.innerHTML = ''; });

function mountDialog(mode: 'create' | 'edit' = 'create', discover?: FlowerModelCatalogDiscovery, keyConfigured = true) {
  const host = document.createElement('div'); document.body.append(host);
  const [open, setOpen] = createSignal(true);
  const [provider, setProvider] = createSignal<FlowerProviderDraft>({ id: 'brand', type: 'openai', models: defaultFlowerProviderModels('openai') });
  let confirmed: FlowerProviderDraft | undefined;
  const dispose = render(() => <FlowerProviderDialog onDiscoverModels={discover} open={open()} mode={mode} provider={provider()} keyConfigured={keyConfigured} webSearchKeyConfigured={false} onOpenChange={setOpen} onConfirm={(draft) => { confirmed = JSON.parse(JSON.stringify(draft)); }}/>, host);
  const button = (text: string) => {
    const el = [...host.querySelectorAll('button')].find((element) => element.textContent?.trim() === text);
    if (!el) throw new Error(`Missing button: ${text}`);
    return el;
  };
  const type = (value: string) => (host.querySelector(`[aria-controls="flower-provider-type-${value}"]`) as HTMLButtonElement).click();
  const selected = () => host.querySelectorAll('input[type="checkbox"]:checked').length;
  const search = (value: string) => {
    const el = host.querySelector('input[placeholder="Search models"]') as HTMLInputElement;
    el.value = value; el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  return { host, dispose, button, type, selected, search, setOpen, setProvider, confirmed: () => confirmed! };
}

describe('shared Flower provider dialog', () => {
  it.each([
    { type: 'openai', keyConfigured: false, draftKey: '', blocked: true },
    { type: 'openai', keyConfigured: true, draftKey: '', blocked: false },
    { type: 'openai', keyConfigured: false, draftKey: 'new-key', blocked: false },
    { type: 'ollama', keyConfigured: false, draftKey: '', blocked: false },
    { type: 'openai_compatible', keyConfigured: false, draftKey: '', blocked: false },
  ] as const)('checks $type stored=$keyConfigured draft=$draftKey before saving', ({ type, keyConfigured, draftKey, blocked }) => {
    const dialog = mountDialog('edit', undefined, keyConfigured);
    try {
      dialog.setProvider({ id: 'provider', type, base_url: 'http://localhost:11434/v1', provider_api_key: draftKey,
        models: [{ model_name: 'agent', context_window: 32768 }] });
      expect(dialog.button('Save provider').disabled).toBe(blocked);
      if (type === 'ollama' || type === 'openai_compatible') expect(dialog.host.textContent).toContain('API key optional');
      dialog.button('Save provider').click();
      expect(Boolean(dialog.confirmed())).toBe(!blocked);
    } finally { dialog.dispose(); }
  });

  it('blocks Brave search without its separate key', () => {
    const dialog = mountDialog('edit');
    try {
      dialog.setProvider({ id: 'provider', type: 'openai_compatible', base_url: 'https://example.com/v1', web_search: { mode: 'brave' },
        models: [{ model_name: 'agent', context_window: 32768 }] });
      expect(dialog.button('Save provider').disabled).toBe(true);
      expect(dialog.host.textContent).toContain('Needs Brave key');
    } finally { dialog.dispose(); }
  });
  it('refreshes native capabilities from the server and shows mixed support without brand inference', async () => {
    vi.useFakeTimers();
    const models = defaultFlowerProviderModels('openai').map((model) => ({ ...model, web_search: { status: 'available', reason: 'catalog_supported' } as const }));
    const discover = vi.fn(async () => ({ models }));
    const dialog = mountDialog('edit', discover);
    try {
      dialog.setProvider({ id: 'brand', type: 'openai', models: defaultFlowerProviderModels('openai') });
      expect(dialog.host.textContent).not.toContain('OpenAI built-in web search');
      await vi.advanceTimersByTimeAsync(1000);
      expect(dialog.host.querySelectorAll('[data-web-search="available"]')).toHaveLength(models.length);
      expect(discover).toHaveBeenCalledTimes(1);
      dialog.setProvider({ id: 'brand', type: 'openai', models: [models[0], { ...models[1], web_search: { status: 'unavailable', reason: 'not_integrated' } }] });
      await vi.advanceTimersByTimeAsync(1000);
      expect(discover).toHaveBeenCalledTimes(1);
      expect(dialog.host.textContent).toContain('Web search available for some models');
      expect(dialog.host.querySelector('[data-web-search="unavailable"]')?.textContent).toBe('Web search not integrated');
      expect(dialog.button('Save provider').disabled).toBe(false);
    } finally { dialog.dispose(); vi.useRealTimers(); }
  });

  it('shows DeepSeek as unsupported while keeping the provider usable', async () => {
    vi.useFakeTimers();
    const models = defaultFlowerProviderModels('deepseek').map((model) => ({ ...model, web_search: { status: 'unavailable', reason: 'unsupported' } as const }));
    const discover = vi.fn(async () => ({ models }));
    const dialog = mountDialog('edit', discover);
    try {
      dialog.setProvider({ id: 'brand', type: 'deepseek', models: defaultFlowerProviderModels('deepseek') });
      await vi.advanceTimersByTimeAsync(1000);
      expect(dialog.host.querySelector('[data-web-search="available"]')).toBeNull();
      expect(dialog.host.querySelectorAll('[data-web-search="unavailable"]')).toHaveLength(models.length);
      expect(dialog.host.textContent).toContain('Web search not supported');
      expect(dialog.button('Save provider').disabled).toBe(false);
    } finally { dialog.dispose(); vi.useRealTimers(); }
  });

  it('keeps a disabled custom vision model visible after clearing and reopening', () => {
    const dialog = mountDialog('edit');
    try {
      const custom = { model_name: 'custom-vision', context_window: 32000, input_modalities: ['text', 'image'] };
      dialog.setProvider({ id: 'brand', type: 'deepseek', models: [...defaultFlowerProviderModels('deepseek'), custom] });
      dialog.button('Clear selection').click();
      expect(dialog.selected()).toBe(0);
      expect(dialog.host.textContent).toContain(custom.model_name);
      dialog.button('Save provider').click();
      const saved = serializeFlowerProvider(dialog.confirmed());
      dialog.setOpen(false);
      dialog.setProvider({ ...saved, models: resolveFlowerProviderModels(saved) });
      dialog.setOpen(true);
      expect(dialog.host.textContent).toContain(custom.model_name);
      dialog.button('Select all').click();
      dialog.button('Save provider').click();
      expect(dialog.confirmed().models).toContainEqual(custom);
    } finally { dialog.dispose(); }
  });

  it('selects every model on creation and provider switch, including DeepSeek Vision', () => {
    const dialog = mountDialog();
    try {
      dialog.type('openai');
      expect(dialog.selected()).toBe(defaultFlowerProviderModels('openai').length);
      for (const type of ['google', 'deepseek', 'anthropic', 'groq'] as const) {
        dialog.type(type);
        expect(dialog.selected()).toBe(defaultFlowerProviderModels(type).length);
      }
      dialog.type('deepseek');
      expect(dialog.host.textContent).toContain('Vision');
      dialog.button('Save provider').click();
      expect(dialog.confirmed().models.some((model) => model.input_modalities?.includes('image'))).toBe(true);
      dialog.type('openrouter');
      expect(dialog.selected()).toBe(0);
    } finally { dialog.dispose(); }
  });

  it('preserves exclusions through search, collapse, save and reopen', () => {
    const dialog = mountDialog();
    try {
      dialog.type('openai');
      const total = defaultFlowerProviderModels('openai').length;
      const checkbox = dialog.host.querySelector('input[type="checkbox"]') as HTMLInputElement;
      checkbox.click();
      expect(dialog.selected()).toBe(total - 1);
      dialog.search('no-matching-model');
      expect(dialog.selected()).toBe(0);
      expect(dialog.host.textContent).toContain(`${total - 1} selected`);
      dialog.type('openai'); dialog.type('openai');
      dialog.search('');
      expect(dialog.selected()).toBe(total - 1);
      dialog.button('Save provider').click();
      const saved = serializeFlowerProvider(dialog.confirmed());
      expect(saved.model_selection?.disabled_models).toHaveLength(1);
      dialog.setOpen(false);
      dialog.setProvider({ ...saved, models: resolveFlowerProviderModels(saved) });
      dialog.setOpen(true); dialog.type('openai');
      expect(dialog.selected()).toBe(total - 1);
      dialog.button('Select all').click(); expect(dialog.selected()).toBe(total);
      dialog.button('Clear selection').click(); expect(dialog.selected()).toBe(0);
    } finally { dialog.dispose(); }
  });
});
