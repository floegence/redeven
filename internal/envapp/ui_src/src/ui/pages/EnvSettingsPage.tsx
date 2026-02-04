import { Show, createEffect, createMemo, createResource, createSignal } from 'solid-js';
import {
  Button,
  Card,
  ConfirmDialog,
  Input,
  LoadingOverlay,
  useNotification,
} from '@floegence/floe-webapp-core';
import { useProtocol } from '@floegence/floe-webapp-protocol';

import { fetchGatewayJSON } from '../services/gatewayApi';
import { useEnvContext } from './EnvContext';

type SettingsResponse = Readonly<{
  config_path: string;
  connection: Readonly<{
    controlplane_base_url: string;
    environment_id: string;
    agent_instance_id: string;
    direct: Readonly<{
      ws_url: string;
      channel_id: string;
      channel_init_expire_at_unix_s: number;
      default_suite: number;
      e2ee_psk_set: boolean;
    }>;
  }>;
  runtime: Readonly<{ root_dir: string; shell: string }>;
  logging: Readonly<{ log_format: string; log_level: string }>;
  codespaces: Readonly<{ code_server_port_min: number; code_server_port_max: number }>;
  permission_policy: any | null;
  ai: any | null;
}>;

function defaultAIConfigTemplate(): string {
  return JSON.stringify(
    {
      default_model: 'openai/gpt-5-mini',
      models: [{ id: 'openai/gpt-5-mini', label: 'GPT-5 Mini' }],
      providers: [{ id: 'openai', type: 'openai', base_url: 'https://api.openai.com/v1', api_key_env: 'OPENAI_API_KEY' }],
    },
    null,
    2,
  );
}

function defaultPermissionPolicyTemplate(): string {
  return JSON.stringify(
    { schema_version: 1, local_max: { read: true, write: false, execute: true } },
    null,
    2,
  );
}

export function EnvSettingsPage() {
  const env = useEnvContext();
  const protocol = useProtocol();
  const notify = useNotification();

  const key = createMemo<number | null>(() => (protocol.status() === 'connected' ? env.settingsSeq() : null));

  const [settings, { refetch }] = createResource<SettingsResponse | null, number | null>(
    () => key(),
    async (k) => (k == null ? null : await fetchGatewayJSON<SettingsResponse>('/_redeven_proxy/api/settings', { method: 'GET' })),
  );

  const canInteract = createMemo(() => protocol.status() === 'connected' && !settings.loading && !settings.error);

  const [runtimeDirty, setRuntimeDirty] = createSignal(false);
  const [loggingDirty, setLoggingDirty] = createSignal(false);
  const [codespacesDirty, setCodespacesDirty] = createSignal(false);
  const [policyDirty, setPolicyDirty] = createSignal(false);
  const [aiDirty, setAiDirty] = createSignal(false);

  const [rootDir, setRootDir] = createSignal('');
  const [shell, setShell] = createSignal('');

  const [logFormat, setLogFormat] = createSignal('');
  const [logLevel, setLogLevel] = createSignal('');

  const [codePortMin, setCodePortMin] = createSignal<number | ''>('');
  const [codePortMax, setCodePortMax] = createSignal<number | ''>('');

  const [permissionPolicyJSON, setPermissionPolicyJSON] = createSignal('');
  const [aiJSON, setAiJSON] = createSignal('');

  const [runtimeSaving, setRuntimeSaving] = createSignal(false);
  const [loggingSaving, setLoggingSaving] = createSignal(false);
  const [codespacesSaving, setCodespacesSaving] = createSignal(false);
  const [policySaving, setPolicySaving] = createSignal(false);
  const [aiSaving, setAiSaving] = createSignal(false);
  const [disableAIOpen, setDisableAIOpen] = createSignal(false);
  const [disableAISaving, setDisableAISaving] = createSignal(false);

  const [runtimeError, setRuntimeError] = createSignal<string | null>(null);
  const [loggingError, setLoggingError] = createSignal<string | null>(null);
  const [codespacesError, setCodespacesError] = createSignal<string | null>(null);
  const [policyError, setPolicyError] = createSignal<string | null>(null);
  const [aiError, setAiError] = createSignal<string | null>(null);

  // Reset form state when settings are loaded (but do not overwrite user edits).
  createEffect(() => {
    const s = settings();
    if (!s) return;

    if (!runtimeDirty()) {
      setRootDir(String(s.runtime?.root_dir ?? ''));
      setShell(String(s.runtime?.shell ?? ''));
    }
    if (!loggingDirty()) {
      setLogFormat(String(s.logging?.log_format ?? ''));
      setLogLevel(String(s.logging?.log_level ?? ''));
    }
    if (!codespacesDirty()) {
      const min = s.codespaces?.code_server_port_min;
      const max = s.codespaces?.code_server_port_max;
      setCodePortMin(typeof min === 'number' ? min : '');
      setCodePortMax(typeof max === 'number' ? max : '');
    }
    if (!policyDirty()) {
      setPermissionPolicyJSON(s.permission_policy ? JSON.stringify(s.permission_policy, null, 2) : defaultPermissionPolicyTemplate());
    }
    if (!aiDirty()) {
      setAiJSON(s.ai ? JSON.stringify(s.ai, null, 2) : defaultAIConfigTemplate());
    }
  });

  // Focus/scroll to the requested section when opened via "Open Settings" from other pages.
  createEffect(() => {
    const seq = env.settingsFocusSeq();
    const section = env.settingsFocusSection();
    if (!seq || !section) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(`redeven-settings-${section}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  const saveSettings = async (body: any) => {
    await fetchGatewayJSON<SettingsResponse>('/_redeven_proxy/api/settings', { method: 'PUT', body: JSON.stringify(body) });
    env.bumpSettingsSeq();
  };

  const saveRuntime = async () => {
    setRuntimeError(null);
    setRuntimeSaving(true);
    try {
      await saveSettings({ root_dir: String(rootDir() ?? ''), shell: String(shell() ?? '') });
      setRuntimeDirty(false);
      notify.success('Saved', 'Runtime settings saved. Restart required.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRuntimeError(msg || 'Save failed.');
      notify.error('Save failed', msg || 'Request failed.');
    } finally {
      setRuntimeSaving(false);
    }
  };

  const saveLogging = async () => {
    setLoggingError(null);
    setLoggingSaving(true);
    try {
      await saveSettings({ log_format: String(logFormat() ?? ''), log_level: String(logLevel() ?? '') });
      setLoggingDirty(false);
      notify.success('Saved', 'Logging settings saved. Restart required.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoggingError(msg || 'Save failed.');
      notify.error('Save failed', msg || 'Request failed.');
    } finally {
      setLoggingSaving(false);
    }
  };

  const saveCodespaces = async () => {
    setCodespacesError(null);
    const min = codePortMin();
    const max = codePortMax();
    if (min === '' || max === '') {
      setCodespacesError('Please provide both port min and port max.');
      return;
    }

    setCodespacesSaving(true);
    try {
      await saveSettings({ code_server_port_min: Number(min), code_server_port_max: Number(max) });
      setCodespacesDirty(false);
      notify.success('Saved', 'Codespaces settings saved. Restart required.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCodespacesError(msg || 'Save failed.');
      notify.error('Save failed', msg || 'Request failed.');
    } finally {
      setCodespacesSaving(false);
    }
  };

  const savePolicy = async () => {
    setPolicyError(null);
    const raw = String(permissionPolicyJSON() ?? '').trim();
    if (!raw) {
      setPolicyError('Please provide a JSON object, or use null.');
      return;
    }
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setPolicyError('Invalid JSON.');
      return;
    }

    setPolicySaving(true);
    try {
      await saveSettings({ permission_policy: parsed });
      setPolicyDirty(false);
      notify.success('Saved', 'Permission policy saved. Restart required.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPolicyError(msg || 'Save failed.');
      notify.error('Save failed', msg || 'Request failed.');
    } finally {
      setPolicySaving(false);
    }
  };

  const saveAI = async () => {
    setAiError(null);
    const raw = String(aiJSON() ?? '').trim();
    if (!raw) {
      setAiError('Please provide an AI config JSON object, or click "Disable AI".');
      return;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setAiError('Invalid JSON.');
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setAiError('AI config must be a JSON object.');
      return;
    }

    setAiSaving(true);
    try {
      await saveSettings({ ai: parsed });
      setAiDirty(false);
      notify.success('Saved', 'AI settings updated.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAiError(msg || 'Save failed.');
      notify.error('Save failed', msg || 'Request failed.');
    } finally {
      setAiSaving(false);
    }
  };

  const disableAI = async () => {
    setDisableAISaving(true);
    setAiError(null);
    try {
      await saveSettings({ ai: null });
      setAiDirty(false);
      setDisableAIOpen(false);
      notify.success('Disabled', 'AI has been disabled.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAiError(msg || 'Disable failed.');
      notify.error('Disable failed', msg || 'Request failed.');
    } finally {
      setDisableAISaving(false);
    }
  };

  const s = () => settings();
  const configPath = () => String(s()?.config_path ?? '').trim();

  return (
    <div class="h-full min-h-0 overflow-auto">
      <div class="p-4 space-y-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-sm font-semibold">Settings</div>
            <div class="text-xs text-muted-foreground">
              AI changes apply immediately. Other changes are written to the config file and require an agent restart.
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={settings.loading}>
            Refresh
          </Button>
        </div>

        <Show when={settings.error}>
          <div class="text-xs text-error break-words">
            {settings.error instanceof Error ? settings.error.message : String(settings.error)}
          </div>
        </Show>

        <Card>
          <div class="p-4 space-y-2">
            <div class="text-sm font-medium">Config file</div>
            <div class="text-xs text-muted-foreground">
              Path: <code class="px-1 py-0.5 bg-muted rounded">{configPath() || '(unknown)'}</code>
            </div>
          </div>
        </Card>

        <Card>
          <div class="p-4 space-y-3">
            <div class="text-sm font-medium">Connection</div>
            <div class="text-xs text-muted-foreground">These fields are managed by the control plane and are read-only.</div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              <div>
                <div class="text-muted-foreground">Control plane</div>
                <div class="font-mono break-all">{String(s()?.connection?.controlplane_base_url ?? '')}</div>
              </div>
              <div>
                <div class="text-muted-foreground">Environment ID</div>
                <div class="font-mono break-all">{String(s()?.connection?.environment_id ?? '')}</div>
              </div>
              <div>
                <div class="text-muted-foreground">Agent instance ID</div>
                <div class="font-mono break-all">{String(s()?.connection?.agent_instance_id ?? '')}</div>
              </div>
              <div>
                <div class="text-muted-foreground">Direct channel</div>
                <div class="font-mono break-all">{String(s()?.connection?.direct?.channel_id ?? '')}</div>
              </div>
              <div>
                <div class="text-muted-foreground">Direct suite</div>
                <div class="font-mono">{String(s()?.connection?.direct?.default_suite ?? '')}</div>
              </div>
              <div>
                <div class="text-muted-foreground">Init expire (unix_s)</div>
                <div class="font-mono">{String(s()?.connection?.direct?.channel_init_expire_at_unix_s ?? '')}</div>
              </div>
              <div class="md:col-span-2">
                <div class="text-muted-foreground">Direct ws_url</div>
                <div class="font-mono break-all">{String(s()?.connection?.direct?.ws_url ?? '')}</div>
              </div>
              <div>
                <div class="text-muted-foreground">E2EE PSK</div>
                <div class="font-mono">{s()?.connection?.direct?.e2ee_psk_set ? 'set' : 'missing'}</div>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div class="p-4 space-y-3">
            <div class="flex items-center justify-between gap-2">
              <div>
                <div class="text-sm font-medium">Runtime</div>
                <div class="text-xs text-muted-foreground">Restart required.</div>
              </div>
              <Button size="sm" variant="default" onClick={() => void saveRuntime()} loading={runtimeSaving()} disabled={!canInteract()}>
                Save
              </Button>
            </div>

            <Show when={runtimeError()}>
              <div class="text-xs text-error break-words">{runtimeError()}</div>
            </Show>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium mb-1">root_dir</label>
                <Input
                  value={rootDir()}
                  onInput={(e) => {
                    setRootDir(e.currentTarget.value);
                    setRuntimeDirty(true);
                  }}
                  placeholder="/home/user"
                  size="sm"
                  class="w-full"
                  disabled={!canInteract()}
                />
              </div>
              <div>
                <label class="block text-xs font-medium mb-1">shell</label>
                <Input
                  value={shell()}
                  onInput={(e) => {
                    setShell(e.currentTarget.value);
                    setRuntimeDirty(true);
                  }}
                  placeholder="/bin/bash"
                  size="sm"
                  class="w-full"
                  disabled={!canInteract()}
                />
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div class="p-4 space-y-3">
            <div class="flex items-center justify-between gap-2">
              <div>
                <div class="text-sm font-medium">Logging</div>
                <div class="text-xs text-muted-foreground">Restart required.</div>
              </div>
              <Button size="sm" variant="default" onClick={() => void saveLogging()} loading={loggingSaving()} disabled={!canInteract()}>
                Save
              </Button>
            </div>

            <Show when={loggingError()}>
              <div class="text-xs text-error break-words">{loggingError()}</div>
            </Show>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium mb-1">log_format</label>
                <Input
                  value={logFormat()}
                  onInput={(e) => {
                    setLogFormat(e.currentTarget.value);
                    setLoggingDirty(true);
                  }}
                  placeholder="text | json"
                  size="sm"
                  class="w-full"
                  disabled={!canInteract()}
                />
              </div>
              <div>
                <label class="block text-xs font-medium mb-1">log_level</label>
                <Input
                  value={logLevel()}
                  onInput={(e) => {
                    setLogLevel(e.currentTarget.value);
                    setLoggingDirty(true);
                  }}
                  placeholder="debug | info | warn | error"
                  size="sm"
                  class="w-full"
                  disabled={!canInteract()}
                />
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div class="p-4 space-y-3">
            <div class="flex items-center justify-between gap-2">
              <div>
                <div class="text-sm font-medium">Codespaces</div>
                <div class="text-xs text-muted-foreground">Restart required.</div>
              </div>
              <Button
                size="sm"
                variant="default"
                onClick={() => void saveCodespaces()}
                loading={codespacesSaving()}
                disabled={!canInteract()}
              >
                Save
              </Button>
            </div>

            <Show when={codespacesError()}>
              <div class="text-xs text-error break-words">{codespacesError()}</div>
            </Show>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium mb-1">code_server_port_min</label>
                <Input
                  value={codePortMin() === '' ? '' : String(codePortMin())}
                  onInput={(e) => {
                    const v = e.currentTarget.value.trim();
                    setCodePortMin(v ? Number(v) : '');
                    setCodespacesDirty(true);
                  }}
                  placeholder="20000"
                  size="sm"
                  class="w-full"
                  disabled={!canInteract()}
                />
              </div>
              <div>
                <label class="block text-xs font-medium mb-1">code_server_port_max</label>
                <Input
                  value={codePortMax() === '' ? '' : String(codePortMax())}
                  onInput={(e) => {
                    const v = e.currentTarget.value.trim();
                    setCodePortMax(v ? Number(v) : '');
                    setCodespacesDirty(true);
                  }}
                  placeholder="21000"
                  size="sm"
                  class="w-full"
                  disabled={!canInteract()}
                />
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div class="p-4 space-y-3">
            <div class="flex items-center justify-between gap-2">
              <div>
                <div class="text-sm font-medium">Permission policy</div>
                <div class="text-xs text-muted-foreground">Restart required.</div>
              </div>
              <Button size="sm" variant="default" onClick={() => void savePolicy()} loading={policySaving()} disabled={!canInteract()}>
                Save
              </Button>
            </div>

            <Show when={policyError()}>
              <div class="text-xs text-error break-words">{policyError()}</div>
            </Show>

            <textarea
              class="w-full h-[220px] font-mono text-xs border border-border rounded px-2 py-2 bg-background resize-y"
              value={permissionPolicyJSON()}
              onInput={(e) => {
                setPermissionPolicyJSON(e.currentTarget.value);
                setPolicyDirty(true);
              }}
              spellcheck={false}
              disabled={!canInteract()}
            />
          </div>
        </Card>

        <div id="redeven-settings-ai">
          <Card>
            <div class="p-4 space-y-3">
            <div class="flex items-center justify-between gap-2">
              <div>
                <div class="text-sm font-medium">AI</div>
                <div class="text-xs text-muted-foreground">
                  API keys are never stored. Use <code class="px-1 py-0.5 bg-muted rounded">api_key_env</code>.
                </div>
              </div>
              <div class="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setDisableAIOpen(true)}
                  disabled={!canInteract() || aiSaving()}
                >
                  Disable AI
                </Button>
                <Button size="sm" variant="default" onClick={() => void saveAI()} loading={aiSaving()} disabled={!canInteract()}>
                  Save
                </Button>
              </div>
            </div>

            <Show when={aiError()}>
              <div class="text-xs text-error break-words">{aiError()}</div>
            </Show>

            <textarea
              class="w-full h-[320px] font-mono text-xs border border-border rounded px-2 py-2 bg-background resize-y"
              value={aiJSON()}
              onInput={(e) => {
                setAiJSON(e.currentTarget.value);
                setAiDirty(true);
              }}
              spellcheck={false}
              disabled={!canInteract()}
            />
            </div>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={disableAIOpen()}
        onOpenChange={(open) => setDisableAIOpen(open)}
        title="Disable AI"
        confirmText="Disable"
        variant="destructive"
        loading={disableAISaving()}
        onConfirm={() => void disableAI()}
      >
        <div class="space-y-2">
          <p class="text-sm">Are you sure you want to disable AI?</p>
          <p class="text-xs text-muted-foreground">
            This will remove the <code class="px-1 py-0.5 bg-muted rounded">ai</code> section from the agent config file.
          </p>
        </div>
      </ConfirmDialog>

      <LoadingOverlay visible={protocol.status() !== 'connected'} message="Connecting to agent..." />
      <LoadingOverlay visible={settings.loading && protocol.status() === 'connected'} message="Loading settings..." />
    </div>
  );
}
