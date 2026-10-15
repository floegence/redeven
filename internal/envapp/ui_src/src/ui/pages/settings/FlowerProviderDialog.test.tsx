// @vitest-environment jsdom
import { backendModelsForProviderType, providerDefaultsFixture } from '../../../../../../flower_ui/testing/providerCatalogFixture';
import { Show, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowerProviderDialog } from '../../../../../../flower_ui/src/settings/FlowerProviderDialog';
import { cloneFlowerModel, resolveFlowerProviderModels, serializeFlowerProvider } from '../../../../../../flower_ui/src/settings/modelSelection';
import type { FlowerProviderDraft, FlowerModelCatalogDiscovery } from '../../../../../../flower_ui/src/contracts/flowerSurfaceContracts';

vi.mock('@floegence/floe-webapp-core/ui', async (original) => ({
  ...await original<typeof import('@floegence/floe-webapp-core/ui')>(),
  createFloatingPresence: (options: { open: () => boolean }) => ({
    mounted: () => Boolean(options.open()),
    exiting: () => false,
    state: () => (options.open() ? 'entered' : 'exited'),
  }),
  Button: (props: any) => (
    <button ref={props.ref} type="button" aria-label={props['aria-label']} disabled={props.disabled} onClick={props.onClick}>
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
      onBlur={props.onBlur}
      onKeyDown={props.onKeyDown}
      ref={props.ref}
      aria-label={props['aria-label']}
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
  const [provider, setProvider] = createSignal<FlowerProviderDraft>({ id: 'initial', type: 'openai', models: [] });
  const [catalog, setCatalog] = createSignal<FlowerProviderDraft['catalog_models']>();
  const [defaults, setDefaults] = createSignal(providerDefaultsFixture);
  let confirmed: FlowerProviderDraft | undefined;
  const dispose = render(() => <FlowerProviderDialog providerDefaults={defaults()} catalogModels={catalog()} onDiscoverModels={discover} open={open()} mode={mode} provider={provider()} keyConfigured={keyConfigured} webSearchKeyConfigured={false} onOpenChange={setOpen} onConfirm={(draft) => { confirmed = JSON.parse(JSON.stringify(draft)); }}/>, host);
  const button = (text: string) => {
    const el = [...host.querySelectorAll('button')].find(element => element.textContent?.includes(text) || element.getAttribute('aria-label') === text);
    if (!el) throw new Error(`Missing button: ${text}`);
    return el;
  };
  const type = (value: string) => (host.querySelector(`[aria-controls="flower-provider-type-${value}"]`) as HTMLButtonElement).click();
  const selected = () => host.querySelectorAll('.flower-provider-models input[type="checkbox"]:checked').length;
  const search = (value: string) => {
    const el = host.querySelector('input[placeholder="Search models"]') as HTMLInputElement;
    el.value = value; el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  return { host, dispose, button, type, selected, search, setOpen, setProvider, setCatalog, setDefaults, confirmed: () => confirmed! };
}

describe('shared Flower provider dialog', () => {
  const inputValue = (input: HTMLInputElement, value: string) => {
    input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const finishInput = (input: HTMLInputElement) => input.dispatchEvent(new FocusEvent('blur'));

  it.each(['openai', 'anthropic', 'google', 'deepseek', 'openai_compatible'] as const)('renames the %s connection from its title without changing its identity', async type => {
    const discover = vi.fn(async () => ({ models: [] }));
    const dialog = mountDialog('edit', discover);
    try {
      dialog.setProvider({ id: 'connection', type, base_url: 'https://proxy.example/v1', models: [] });
      const identity = dialog.host.querySelector('.flower-provider-identity')!;
      const edit = () => identity.querySelector<HTMLButtonElement>('button')!;
      edit().click();
      const input = identity.querySelector<HTMLInputElement>('input')!;
      expect(input).not.toBeNull();
      await Promise.resolve();
      expect(document.activeElement).toBe(input);
      inputValue(input, '  Work account  ');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
      expect(identity.querySelector('input')).toBe(input);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(identity.querySelector('h2')?.textContent).toBe('Work account');
      await Promise.resolve();
      expect(document.activeElement).toBe(edit());
      edit().click();
      const cancelled = identity.querySelector<HTMLInputElement>('input')!;
      inputValue(cancelled, 'Discarded alias');
      cancelled.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(identity.querySelector('h2')?.textContent).toBe('Work account');
      dialog.button('Save provider').click();
      expect(serializeFlowerProvider(dialog.confirmed())).toMatchObject({ id: 'connection', type, name: 'Work account', base_url: 'https://proxy.example/v1' });
      expect(discover).not.toHaveBeenCalled();
    } finally { dialog.dispose(); }
  });

  it('restores the brand after clearing a connection alias', () => {
    const dialog = mountDialog('edit');
    try {
      dialog.setProvider({ id: 'connection', type: 'openai', name: 'Work account', models: [] });
      const identity = dialog.host.querySelector('.flower-provider-identity')!;
      expect(identity.querySelector('h2')?.textContent).toBe('Work account');
      identity.querySelector<HTMLButtonElement>('button')!.click();
      const input = identity.querySelector<HTMLInputElement>('input')!;
      inputValue(input, '   '); finishInput(input);
      expect(identity.querySelector('h2')?.textContent).toBe('OpenAI');
      dialog.button('Save provider').click();
      expect(dialog.confirmed().name).toBe('');
    } finally { dialog.dispose(); }
  });

  it('gives two new connections of the same brand independent aliases and identities', () => {
    const saved = ['Personal', 'Work'].map((name, index) => {
      const dialog = mountDialog();
      try {
        dialog.setProvider({ id: `openai-${index}`, type: 'openai', name: 'OpenAI', base_url: 'https://api.openai.com/v1', models: [] });
        dialog.type('openai');
        const identity = dialog.host.querySelector('.flower-provider-identity')!;
        identity.querySelector<HTMLButtonElement>('button')!.click();
        const input = identity.querySelector<HTMLInputElement>('input')!;
        inputValue(input, name); finishInput(input);
        dialog.button('Save provider').click();
        return serializeFlowerProvider(dialog.confirmed());
      } finally { dialog.dispose(); }
    });
    expect(saved.map(provider => provider.name)).toEqual(['Personal', 'Work']);
    expect(saved.map(provider => provider.id)).toEqual(['openai-0', 'openai-1']);
    expect(saved.every(provider => provider.type === 'openai')).toBe(true);
  });

  it.each([
    { type: 'openai', defaultBaseURL: 'https://api.openai.com/v1' },
    { type: 'google', defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta/openai' },
    { type: 'anthropic', defaultBaseURL: 'https://api.anthropic.com' },
  ] as const)('edits and saves the $type endpoint for new and existing connections', ({ type, defaultBaseURL }) => {
    for (const mode of ['create', 'edit'] as const) {
      const dialog = mountDialog(mode);
      try {
        const existingBaseURL = 'https://existing.example/v1';
        if (mode === 'create') {
          dialog.setProvider({ id: 'new', type: 'openai', base_url: 'https://api.openai.com/v1', models: [] });
          dialog.type(type);
        } else dialog.setProvider({ id: 'existing', type, base_url: existingBaseURL, models: [] });
        const endpoint = dialog.host.querySelector<HTMLInputElement>(`input[placeholder="${defaultBaseURL}"]`);
        expect(endpoint).not.toBeNull();
        expect(endpoint!.disabled).toBe(false);
        expect(endpoint!.value).toBe(mode === 'create' ? defaultBaseURL : existingBaseURL);
        inputValue(endpoint!, 'https://proxy.example/custom-prefix/v1');
        dialog.button('Save provider').click();
        expect(serializeFlowerProvider(dialog.confirmed()).base_url).toBe('https://proxy.example/custom-prefix/v1');
      } finally { dialog.dispose(); }
    }
  });

  it('discovers a new Ollama connection once and leaves discovered models unselected', async () => {
    const discover = vi.fn(async () => ({ models: [{ model_name: 'local-agent', context_window: 8192, supports_tools: true }] }));
    const dialog = mountDialog('create', discover, false);
    try {
      dialog.type('ollama');
      await vi.waitFor(() => expect(dialog.host.textContent).toContain('local-agent'));
      expect(discover).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'ollama', base_url: 'http://127.0.0.1:11434/v1' }));
      expect(dialog.selected()).toBe(0);
      dialog.type('ollama');
      finishInput(dialog.host.querySelector('input[type=password]')!);
      expect(discover).toHaveBeenCalledTimes(1);
      dialog.button('Save provider').click();
      expect(dialog.confirmed().models).toEqual([]);
    } finally { dialog.dispose(); }
  });

  it('waits for the OpenRouter key to be completed and supports discovery at a changed endpoint', async () => {
    const discover = vi.fn(async () => ({ models: [] }));
    const dialog = mountDialog('create', discover, false);
    try {
      dialog.type('openrouter');
      const key = dialog.host.querySelector<HTMLInputElement>('input[type=password]')!;
      inputValue(key, 'partial'); inputValue(key, 'completed-key');
      expect(discover).not.toHaveBeenCalled();
      finishInput(key);
      await vi.waitFor(() => expect(discover).toHaveBeenCalledTimes(1));
      expect(discover).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'openrouter', api_key: 'completed-key' }));
      finishInput(key); expect(discover).toHaveBeenCalledTimes(1);
      const endpoint = [...dialog.host.querySelectorAll('input')].find(input => input.value === 'https://openrouter.ai/api/v1')!;
      inputValue(endpoint, 'https://router.example/v1');
      expect(discover).toHaveBeenCalledTimes(1);
      finishInput(endpoint);
      await vi.waitFor(() => expect(discover).toHaveBeenCalledTimes(2));
      expect(discover).toHaveBeenLastCalledWith(expect.objectContaining({ base_url: 'https://router.example/v1' }));
    } finally { dialog.dispose(); }
  });

  it.each(['openrouter', 'ollama'] as const)('does not automatically discover an existing %s connection', async type => {
    const discover = vi.fn(async () => ({ models: [] }));
    const dialog = mountDialog('edit', discover);
    try {
      dialog.setProvider({ id: 'existing', type, models: [], base_url: 'https://existing.example/v1' });
      finishInput(dialog.host.querySelector('input[type=password]')!);
      expect(discover).not.toHaveBeenCalled();
      dialog.button('Sync model list').click();
      await vi.waitFor(() => expect(discover).toHaveBeenCalledTimes(1));
    } finally { dialog.dispose(); }
  });

  it('retains selected models after discovery failure, avoids silent retries and permits explicit retry', async () => {
    const discover = vi.fn<FlowerModelCatalogDiscovery>()
      .mockRejectedValueOnce(new Error('Ollama connection refused'))
      .mockResolvedValue({ models: [{ model_name: 'agent', context_window: 8192 }] });
    const dialog = mountDialog('create', discover, false);
    try {
      dialog.setProvider({ id: 'draft', type: 'ollama', models: [{ model_name: 'agent', context_window: 8192 }] });
      dialog.type('ollama');
      await vi.waitFor(() => expect(discover).toHaveBeenCalledTimes(1));
      await Promise.resolve();
      expect(dialog.selected()).toBe(1);
      expect(dialog.button('Save provider').disabled).toBe(false);
      dialog.type('ollama'); expect(discover).toHaveBeenCalledTimes(1);
      dialog.button('Sync model list').click();
      await vi.waitFor(() => expect(discover).toHaveBeenCalledTimes(2));
      expect(dialog.selected()).toBe(1);
    } finally { dialog.dispose(); }
  });

  it.each(['success', 'failure'] as const)('fences a late discovery %s after connection changes', async outcome => {
    let resolve!: (result: { models: FlowerProviderDraft['models'] }) => void;
    let reject!: (error: Error) => void;
    const discover = vi.fn<FlowerModelCatalogDiscovery>(() => new Promise((done, fail) => { resolve = done; reject = fail; }));
    const dialog = mountDialog('create', discover, false);
    try {
      dialog.type('ollama');
      const endpoint = [...dialog.host.querySelectorAll('input')].find(input => input.value === 'http://127.0.0.1:11434/v1')!;
      inputValue(endpoint, 'http://remote.example:11434/v1');
      if (outcome === 'success') resolve({ models: [{ model_name: 'stale-agent', context_window: 8192 }] });
      else reject(new Error('Stale endpoint failure'));
      await Promise.resolve(); await Promise.resolve();
      expect(dialog.host.textContent).not.toContain('stale-agent');
      expect(dialog.host.textContent).not.toContain('Stale endpoint failure');
      expect(dialog.button('Sync model list').disabled).toBe(false);
    } finally { dialog.dispose(); }
  });

  it('fences pending discovery across close and reopen and skips incomplete endpoints', async () => {
    let resolve!: (result: { models: FlowerProviderDraft['models'] }) => void;
    const discover = vi.fn<FlowerModelCatalogDiscovery>(() => new Promise(done => { resolve = done; }));
    const dialog = mountDialog('create', discover, false);
    try {
      dialog.type('ollama'); dialog.setOpen(false); dialog.setOpen(true); dialog.type('openrouter');
      resolve({ models: [{ model_name: 'closed-agent', context_window: 8192 }] });
      await Promise.resolve(); await Promise.resolve();
      expect(dialog.host.textContent).not.toContain('closed-agent');
      const endpoint = [...dialog.host.querySelectorAll('input')].find(input => input.value === 'https://openrouter.ai/api/v1')!;
      inputValue(endpoint, 'https://'); finishInput(endpoint);
      const key = dialog.host.querySelector<HTMLInputElement>('input[type=password]')!;
      inputValue(key, 'key'); finishInput(key);
      expect(discover).toHaveBeenCalledTimes(1);
    } finally { dialog.dispose(); }
  });

  it('uses backend defaults for a new connection and never persists them as user configuration', () => {
    const dialog = mountDialog();
    const backendModel = { model_name: 'server-only-model', context_window: 543210, max_output_tokens: 12345, effective_context_window_percent: 87, input_modalities: ['text', 'image'], supports_tools: true };
    try {
      dialog.setDefaults({ openai: [backendModel] });
      dialog.type('openai');
      expect(dialog.host.textContent).toContain(backendModel.model_name);
      expect(dialog.host.textContent).not.toContain('gpt-6.1-sol');
      expect(dialog.selected()).toBe(0);
      dialog.button('Select all').click();
      dialog.button('Save provider').click();
      expect(dialog.confirmed().models).toEqual([backendModel]);
      const saved = serializeFlowerProvider(dialog.confirmed());
      expect(saved).not.toHaveProperty('model_defaults');
      expect(saved.model_selection?.model_overrides).toEqual([]);
    } finally { dialog.dispose(); }
  });
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
      expect(dialog.host.querySelector('.flower-provider-models') === null).toBe(blocked);
      if (type === 'ollama' || type === 'openai_compatible') expect(dialog.host.textContent).toContain('API key optional');
      dialog.button('Save provider').click();
      expect(Boolean(dialog.confirmed())).toBe(!blocked);
    } finally { dialog.dispose(); }
  });

  it('blocks Brave search without its separate key', () => {
    const dialog = mountDialog('edit');
    try {
      dialog.setProvider({ id: 'provider', type: 'openai_compatible', base_url: 'https://example.com/v1', web_search: { enabled: true, source: 'brave' },
        models: [{ model_name: 'agent', context_window: 32768 }] });
      expect(dialog.button('Save provider').disabled).toBe(true);
      expect(dialog.host.textContent).toContain('Needs Brave key');
    } finally { dialog.dispose(); }
  });
  it('refreshes native capabilities from the server and shows mixed support without brand inference', async () => {
    vi.useFakeTimers();
    const models = backendModelsForProviderType('openai').map(cloneFlowerModel).map((model) => ({ ...model, web_search: { status: 'available', reason: 'catalog_supported' } as const }));
    const discover = vi.fn(async () => ({ models }));
    const dialog = mountDialog('edit', discover);
    try {
      dialog.setProvider({ id: 'brand', type: 'openai', models: backendModelsForProviderType('openai').map(cloneFlowerModel) });
      expect(dialog.host.textContent).not.toContain('OpenAI built-in web search');
      expect(discover).not.toHaveBeenCalled();
      dialog.button('Sync model list').click();
      await vi.advanceTimersByTimeAsync(1000);
      expect(dialog.host.querySelectorAll('[data-web-search="available"]')).toHaveLength(models.length);
      expect(discover).toHaveBeenCalledTimes(1);
      dialog.setCatalog([models[0], { ...models[1], web_search: { status: 'unavailable', reason: 'not_integrated' } }]);
      await vi.advanceTimersByTimeAsync(1000);
      expect(discover).toHaveBeenCalledTimes(1);
      expect(dialog.host.querySelector('[data-web-search="available"]')?.textContent).toBe('Web search');
      expect(dialog.host.querySelector('[data-web-search="unavailable"]')?.textContent).toBe('Web search not integrated');
      expect(dialog.button('Save provider').disabled).toBe(false);
    } finally { dialog.dispose(); vi.useRealTimers(); }
  });

  it('shows DeepSeek as unsupported while keeping the provider usable', async () => {
    vi.useFakeTimers();
    const models = backendModelsForProviderType('deepseek').map(cloneFlowerModel).map((model) => ({ ...model, web_search: { status: 'unavailable', reason: 'unsupported' } as const }));
    const discover = vi.fn(async () => ({ models }));
    const dialog = mountDialog('edit', discover);
    try {
      dialog.setProvider({ id: 'brand', type: 'deepseek', models: backendModelsForProviderType('deepseek').map(cloneFlowerModel) });
      expect(discover).not.toHaveBeenCalled();
      dialog.button('Sync model list').click();
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
      dialog.setProvider({ id: 'brand', type: 'deepseek', models: [...backendModelsForProviderType('deepseek').map(cloneFlowerModel), custom] });
      dialog.button('Clear selection').click();
      expect(dialog.selected()).toBe(0);
      expect(dialog.host.textContent).toContain(custom.model_name);
      dialog.button('Save provider').click();
      const saved = serializeFlowerProvider(dialog.confirmed());
      dialog.setOpen(false);
      dialog.setProvider({ ...saved, models: resolveFlowerProviderModels({ ...saved, model_defaults: providerDefaultsFixture[saved.type] }) });
      dialog.setOpen(true);
      expect(dialog.host.textContent).toContain(custom.model_name);
      dialog.button('Select all').click();
      dialog.button('Save provider').click();
      expect(dialog.confirmed().models).toContainEqual(custom);
    } finally { dialog.dispose(); }
  });

  it('requires deliberate selection on creation and provider switch, including DeepSeek Vision', () => {
    const dialog = mountDialog();
    try {
      dialog.type('openai');
      expect(dialog.selected()).toBe(0);
      for (const type of ['google', 'deepseek', 'anthropic', 'groq'] as const) {
        dialog.type(type);
        expect(dialog.selected()).toBe(0);
      }
      dialog.type('deepseek');
      expect(dialog.host.textContent).toContain('Vision');
      expect(dialog.button('Save provider').disabled).toBe(false);
      dialog.button('Select all').click();
      dialog.button('Save provider').click();
      expect(dialog.confirmed().models.some((model) => model.input_modalities?.includes('image'))).toBe(true);
      dialog.type('openrouter');
      expect(dialog.selected()).toBe(0);
    } finally { dialog.dispose(); }
  });

  it('requires explicit capabilities for a new unknown model before saving', () => {
    const dialog = mountDialog();
    try {
      dialog.type('openai_compatible');
      const name = dialog.host.querySelector<HTMLInputElement>('input[placeholder="Custom model name"]')!;
      name.value = 'unknown-agent'; name.dispatchEvent(new Event('input', { bubbles: true }));
      dialog.button('Add model').click();
      expect(dialog.host.textContent).toContain('Needs capability configuration');
      const context = dialog.host.querySelector<HTMLInputElement>('input[type="number"]')!;
      const output = dialog.host.querySelectorAll<HTMLInputElement>('input[type="number"]')[1]!;
      expect(context.value).toBe(''); expect(output.value).toBe('');
      expect(dialog.button('Save provider').disabled).toBe(false);
      context.value = '32768'; context.dispatchEvent(new Event('input', { bubbles: true }));
      output.value = '4096'; output.dispatchEvent(new Event('input', { bubbles: true }));
      expect(dialog.button('Save provider').disabled).toBe(false);
      const tools = dialog.host.querySelector<HTMLSelectElement>('select[required]')!;
      expect(tools.value).toBe('');
      tools.value = 'supported'; tools.dispatchEvent(new Event('change', { bubbles: true }));
      expect(dialog.button('Save provider').disabled).toBe(false);
      dialog.button('Save provider').click();
      expect(dialog.confirmed().models).toEqual([expect.objectContaining({ model_name: 'unknown-agent', context_window: 32768, max_output_tokens: 4096, supports_tools: true })]);
    } finally { dialog.dispose(); }
  });

  it('preserves explicit selection through search, repeated provider selection, save and reopen', () => {
    const dialog = mountDialog();
    try {
      dialog.type('openai');
      const total = backendModelsForProviderType('openai').map(cloneFlowerModel).length;
      dialog.button('Select all').click();
      const checkbox = dialog.host.querySelector('.flower-provider-models input[type="checkbox"]') as HTMLInputElement;
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
      expect(saved.model_selection?.selected_models).toHaveLength(total - 1);
      dialog.setOpen(false);
      dialog.setProvider({ ...saved, models: resolveFlowerProviderModels({ ...saved, model_defaults: providerDefaultsFixture[saved.type] }) });
      dialog.setOpen(true); dialog.type('openai');
      expect(dialog.selected()).toBe(total - 1);
      dialog.button('Select all').click(); expect(dialog.selected()).toBe(total);
      dialog.button('Clear selection').click(); expect(dialog.selected()).toBe(0);
    } finally { dialog.dispose(); }
  });
});

describe('ChatGPT local authentication boundary', () => {
  function localDialog(available: boolean, auth: import('../../../../../../flower_ui/src/contracts/flowerSurfaceContracts').FlowerChatGPTAuth = vi.fn(async () => ({ id: 'attempt', state: 'waiting' }))) {
    const host = document.createElement('div'); document.body.append(host);
    const [open, setOpen] = createSignal(true), [local, setLocal] = createSignal(available), [binding, setBinding] = createSignal('local-connection');
    const provider = { id: 'openai', type: 'openai' as const, models: [] };
    const dispose = render(() => <FlowerProviderDialog providerDefaults={providerDefaultsFixture} open={open()} mode="create" provider={provider} chatGPTAvailable={local()} chatGPTBindingID={binding()} chatGPTAuth={auth} loadChatGPTAccounts={async () => ({ accounts: {}, saved_accounts: [] })} keyConfigured={false} webSearchKeyConfigured={false} onOpenChange={setOpen} onConfirm={vi.fn()} />, host);
    const button = (text: string) => [...host.querySelectorAll('button')].find(el => {
      const visible = el.cloneNode(true) as HTMLElement;
      visible.querySelectorAll('[aria-hidden=true]').forEach(node => node.remove());
      return visible.textContent?.trim() === text;
    })!;
    (host.querySelector('[aria-controls=flower-provider-type-openai]') as HTMLButtonElement).click();
    return { host, button, dispose, setOpen, setLocal, setBinding };
  }
  it('shows the endpoint only for API key authentication and retains its draft across switches', () => {
    const dialog = localDialog(true);
    const endpoint = () => dialog.host.querySelector<HTMLInputElement>('input[placeholder="https://api.openai.com/v1"]');
    try {
      expect(endpoint()).toBeNull();
      dialog.button('API key').click();
      expect(endpoint()).not.toBeNull();
      endpoint()!.value = 'https://proxy.example/v1';
      endpoint()!.dispatchEvent(new Event('input', { bubbles: true }));
      dialog.button('ChatGPT account').click();
      expect(endpoint()).toBeNull();
      dialog.button('API key').click();
      expect(endpoint()!.value).toBe('https://proxy.example/v1');
    } finally { dialog.dispose(); }
  });

  it('disables the remote tab with persistent guidance and no sign-in controls', () => {
    const auth = vi.fn(); const dialog = localDialog(false, auth);
    expect(dialog.button('ChatGPT account').disabled).toBe(true);
    dialog.button('ChatGPT account').click();
    expect(dialog.host.textContent).toContain('ChatGPT sign-in is available only on this device');
    expect(dialog.host.textContent).not.toContain('Continue with ChatGPT');
    expect(dialog.host.querySelector('input[type=password]')).not.toBeNull();
    expect(auth).not.toHaveBeenCalled(); dialog.dispose();
  });
  it('cancels a pending sign-in on target changes and fences a late start response', async () => {
    let resolveStart!: (result: { id: string; state: string }) => void;
    const auth = vi.fn((action: string) => action === 'start' ? new Promise<{ id: string; state: string }>(resolve => { resolveStart = resolve; }) : Promise.resolve({}));
    const dialog = localDialog(true, auth);
    await vi.waitFor(() => expect(dialog.button('Continue with ChatGPT').disabled).toBe(false));
    dialog.button('Continue with ChatGPT').click();
    dialog.setBinding('different-connection'); dialog.setLocal(false);
    resolveStart({ id: 'late-attempt', state: 'waiting' });
    await vi.waitFor(() => expect(auth).toHaveBeenCalledWith('cancel', expect.objectContaining({ attempt_id: 'late-attempt' })));
    expect(dialog.host.textContent).not.toContain('Waiting for authorization'); dialog.dispose();
  });
});

it('saves a configured connection without selecting or discovering a model', () => {
 const discover=vi.fn(async()=>({models:[]}));const dialog=mountDialog('edit',discover);
 try {dialog.setProvider({id:'empty',type:'openai',models:[]});dialog.button('Save provider').click();expect(dialog.confirmed().models).toEqual([]);expect(discover).not.toHaveBeenCalled();} finally{dialog.dispose();}
});

it('keeps prior models and local capability edits after a manual synchronization failure', async () => {
 const discover=vi.fn(async()=>{throw new Error('Model list unavailable');});const dialog=mountDialog('edit',discover);
 try {
  dialog.setProvider({id:'local',type:'openai_compatible',base_url:'https://example.com/v1',models:[{model_name:'agent',context_window:8192,max_output_tokens:1024}]});
  dialog.button('Sync model list').click();await Promise.resolve();await Promise.resolve();
  expect(discover).toHaveBeenCalledTimes(1);expect(dialog.host.textContent).toContain('agent');
  dialog.button('Save provider').click();expect(dialog.confirmed().models[0].context_window).toBe(8192);
 }finally{dialog.dispose();}
});

it('merges background metadata without replacing an unsaved endpoint or selection', () => {
 const dialog=mountDialog('edit');
 try {
  dialog.setProvider({id:'local',type:'openai_compatible',base_url:'https://original.example/v1',models:[{model_name:'agent',context_window:8192,max_output_tokens:1024}]});
  const endpoint=dialog.host.querySelector('input[placeholder="https://your-provider.example.com/v1"]') as HTMLInputElement | null;
  const input=endpoint ?? [...dialog.host.querySelectorAll('input')].find(input=>input.value==='https://original.example/v1')!;
  input.value='https://draft.example/v1';input.dispatchEvent(new Event('input',{bubbles:true}));
  dialog.setCatalog([{model_name:'new-model',context_window:32768}]);
  expect(input.value).toBe('https://draft.example/v1');dialog.button('Save provider').click();
  expect(dialog.confirmed().base_url).toBe('https://draft.example/v1');expect(dialog.confirmed().models.map(model=>model.model_name)).toEqual(['agent']);
 }finally{dialog.dispose();}
});
