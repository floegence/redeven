import { For, Show, createEffect, createMemo, createResource, createSignal } from 'solid-js';
import { useNotification } from '@floegence/floe-webapp-core';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import { Button, Card, ConfirmDialog, Input } from '@floegence/floe-webapp-core/ui';
import { useProtocol } from '@floegence/floe-webapp-protocol';

import { fetchGatewayJSON } from '../services/gatewayApi';
import { useEnvContext } from './EnvContext';

type ViewMode = 'ui' | 'json';

type PermissionSet = Readonly<{ read: boolean; write: boolean; execute: boolean }>;
type PermissionPolicy = Readonly<{
  schema_version: number;
  local_max: PermissionSet;
  by_user?: Record<string, PermissionSet>;
  by_app?: Record<string, PermissionSet>;
}>;

type AIProviderType = 'openai' | 'anthropic' | 'openai_compatible';
type AIProvider = Readonly<{ id: string; type: AIProviderType; base_url?: string; api_key_env: string }>;
type AIModel = Readonly<{ id: string; label?: string }>;
type AIConfig = Readonly<{ default_model: string; models?: AIModel[]; providers: AIProvider[] }>;

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
  permission_policy: PermissionPolicy | null;
  ai: AIConfig | null;
}>;

type PermissionRow = { key: string; read: boolean; write: boolean; execute: boolean };
type AIProviderRow = { id: string; type: AIProviderType; base_url: string; api_key_env: string };
type AIModelRow = { id: string; label: string };

const DEFAULT_CODE_SERVER_PORT_MIN = 20000;
const DEFAULT_CODE_SERVER_PORT_MAX = 21000;

function defaultPermissionPolicy(): PermissionPolicy {
  return { schema_version: 1, local_max: { read: true, write: false, execute: true } };
}

function defaultAIConfig(): AIConfig {
  return {
    default_model: 'openai/gpt-5-mini',
    models: [],
    providers: [{ id: 'openai', type: 'openai', base_url: 'https://api.openai.com/v1', api_key_env: 'OPENAI_API_KEY' }],
  };
}

function isJSONObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function parseJSONOrThrow(raw: string): any {
  const t = String(raw ?? '').trim();
  if (!t) throw new Error('Please provide JSON.');
  try {
    return JSON.parse(t);
  } catch {
    throw new Error('Invalid JSON.');
  }
}

function normalizePortRange(min: number, max: number): { is_default: boolean; effective_min: number; effective_max: number } {
  let m = Number(min);
  let M = Number(max);
  if (!Number.isFinite(m)) m = 0;
  if (!Number.isFinite(M)) M = 0;

  if (m <= 0 || M <= 0 || M > 65535 || m >= M) {
    return { is_default: true, effective_min: DEFAULT_CODE_SERVER_PORT_MIN, effective_max: DEFAULT_CODE_SERVER_PORT_MAX };
  }
  if (m < 1024) m = 1024;
  if (M < 1024) M = 1024;
  if (m >= M) {
    return { is_default: true, effective_min: DEFAULT_CODE_SERVER_PORT_MIN, effective_max: DEFAULT_CODE_SERVER_PORT_MAX };
  }
  return { is_default: false, effective_min: m, effective_max: M };
}

function mapToPermissionRows(m: Record<string, PermissionSet> | undefined): PermissionRow[] {
  if (!m) return [];
  const keys = Object.keys(m);
  keys.sort();
  return keys.map((k) => ({
    key: k,
    read: !!m[k]?.read,
    write: !!m[k]?.write,
    execute: !!m[k]?.execute,
  }));
}

function ViewToggle(props: { value: () => ViewMode; disabled?: boolean; onChange: (v: ViewMode) => void }) {
  const btnClass = (active: boolean) => {
    const base = 'px-2 py-1 text-xs rounded transition-colors';
    if (active) return `${base} bg-background border border-border`;
    return `${base} text-muted-foreground hover:text-foreground`;
  };
  const disabledClass = () => (props.disabled ? 'opacity-60 pointer-events-none' : '');

  return (
    <div class={`flex items-center gap-1 rounded border border-border p-0.5 bg-muted/30 ${disabledClass()}`}>
      <button type="button" class={btnClass(props.value() === 'ui')} onClick={() => props.onChange('ui')}>
        UI
      </button>
      <button type="button" class={btnClass(props.value() === 'json')} onClick={() => props.onChange('json')}>
        JSON
      </button>
    </div>
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

  const [configView, setConfigView] = createSignal<ViewMode>('ui');
  const [connectionView, setConnectionView] = createSignal<ViewMode>('ui');
  const [runtimeView, setRuntimeView] = createSignal<ViewMode>('ui');
  const [loggingView, setLoggingView] = createSignal<ViewMode>('ui');
  const [codespacesView, setCodespacesView] = createSignal<ViewMode>('ui');
  const [policyView, setPolicyView] = createSignal<ViewMode>('ui');
  const [aiView, setAiView] = createSignal<ViewMode>('ui');

  const [runtimeDirty, setRuntimeDirty] = createSignal(false);
  const [loggingDirty, setLoggingDirty] = createSignal(false);
  const [codespacesDirty, setCodespacesDirty] = createSignal(false);
  const [policyDirty, setPolicyDirty] = createSignal(false);
  const [aiDirty, setAiDirty] = createSignal(false);

  const [rootDir, setRootDir] = createSignal('');
  const [shell, setShell] = createSignal('');

  const [logFormat, setLogFormat] = createSignal('');
  const [logLevel, setLogLevel] = createSignal('');

  const [useDefaultCodePorts, setUseDefaultCodePorts] = createSignal(true);
  const [codePortMin, setCodePortMin] = createSignal<number | ''>('');
  const [codePortMax, setCodePortMax] = createSignal<number | ''>('');

  const [policyLocalRead, setPolicyLocalRead] = createSignal(true);
  const [policyLocalWrite, setPolicyLocalWrite] = createSignal(false);
  const [policyLocalExecute, setPolicyLocalExecute] = createSignal(true);
  const [policyByUser, setPolicyByUser] = createSignal<PermissionRow[]>([]);
  const [policyByApp, setPolicyByApp] = createSignal<PermissionRow[]>([]);

  const [aiDefaultModel, setAiDefaultModel] = createSignal('openai/gpt-5-mini');
  const [aiProviders, setAiProviders] = createSignal<AIProviderRow[]>([
    { id: 'openai', type: 'openai', base_url: 'https://api.openai.com/v1', api_key_env: 'OPENAI_API_KEY' },
  ]);
  const [aiUseModelList, setAiUseModelList] = createSignal(false);
  const [aiModels, setAiModels] = createSignal<AIModelRow[]>([]);

  const [runtimeJSON, setRuntimeJSON] = createSignal('');
  const [loggingJSON, setLoggingJSON] = createSignal('');
  const [codespacesJSON, setCodespacesJSON] = createSignal('');
  const [policyJSON, setPolicyJSON] = createSignal('');
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

  const aiEnabled = createMemo(() => !!settings()?.ai);

  const configPath = () => String(settings()?.config_path ?? '').trim();

  const configJSONText = createMemo(() => JSON.stringify({ config_path: configPath() || '' }, null, 2));
  const connectionJSONText = createMemo(() => JSON.stringify(settings()?.connection ?? null, null, 2));

  const buildRuntimePatch = () => ({ root_dir: String(rootDir() ?? ''), shell: String(shell() ?? '') });
  const buildLoggingPatch = () => ({ log_format: String(logFormat() ?? ''), log_level: String(logLevel() ?? '') });
  const buildCodespacesPatch = () => {
    if (useDefaultCodePorts()) return { code_server_port_min: 0, code_server_port_max: 0 };
    const min = codePortMin();
    const max = codePortMax();
    return { code_server_port_min: Number(min), code_server_port_max: Number(max) };
  };

  const buildPolicyValue = (): PermissionPolicy => {
    const localMax: PermissionSet = {
      read: !!policyLocalRead(),
      write: !!policyLocalWrite(),
      execute: !!policyLocalExecute(),
    };

    const mkRow = (r: PermissionRow): PermissionSet => ({
      read: localMax.read ? !!r.read : false,
      write: localMax.write ? !!r.write : false,
      execute: localMax.execute ? !!r.execute : false,
    });

    const byUserRows = policyByUser();
    const byAppRows = policyByApp();

    const by_user: Record<string, PermissionSet> = {};
    for (const r of byUserRows) {
      const k = String(r.key ?? '').trim();
      if (!k) continue;
      if (by_user[k]) throw new Error(`Duplicate by_user key: ${k}`);
      by_user[k] = mkRow(r);
    }

    const by_app: Record<string, PermissionSet> = {};
    for (const r of byAppRows) {
      const k = String(r.key ?? '').trim();
      if (!k) continue;
      if (by_app[k]) throw new Error(`Duplicate by_app key: ${k}`);
      by_app[k] = mkRow(r);
    }

    const out: any = { schema_version: 1, local_max: localMax };
    if (Object.keys(by_user).length > 0) out.by_user = by_user;
    if (Object.keys(by_app).length > 0) out.by_app = by_app;
    return out as PermissionPolicy;
  };

  const buildAIValue = (): AIConfig => {
    const defaultModel = String(aiDefaultModel() ?? '').trim();

    const providers = aiProviders().map((p) => {
      const out: any = {
        id: String(p.id ?? '').trim(),
        type: p.type,
        api_key_env: String(p.api_key_env ?? '').trim(),
      };
      const baseURL = String(p.base_url ?? '').trim();
      if (baseURL) out.base_url = baseURL;
      return out as AIProvider;
    });

    const models: AIModel[] = aiUseModelList()
      ? aiModels().map((m) => {
          const out: any = { id: String(m.id ?? '').trim() };
          const label = String(m.label ?? '').trim();
          if (label) out.label = label;
          return out as AIModel;
        })
      : [];

    return { default_model: defaultModel, providers, models };
  };

  const validateAIValue = (cfg: AIConfig) => {
    const defaultModel = String(cfg.default_model ?? '').trim();
    if (!defaultModel) throw new Error('Missing default_model.');
    const slash = defaultModel.indexOf('/');
    if (slash <= 0 || slash >= defaultModel.length - 1) throw new Error('default_model must be in "<provider>/<model>" format.');

    const providers = Array.isArray(cfg.providers) ? cfg.providers : [];
    if (providers.length === 0) throw new Error('Missing providers.');

    const providerIDs = new Set<string>();
    for (const p of providers) {
      const id = String((p as any).id ?? '').trim();
      const typ = String((p as any).type ?? '').trim();
      const envKey = String((p as any).api_key_env ?? '').trim();
      const baseURL = String((p as any).base_url ?? '').trim();

      if (!id) throw new Error('Provider id is required.');
      if (providerIDs.has(id)) throw new Error(`Duplicate provider id: ${id}`);
      providerIDs.add(id);

      if (typ !== 'openai' && typ !== 'anthropic' && typ !== 'openai_compatible') {
        throw new Error(`Invalid provider type: ${typ || '(empty)'}`);
      }
      if (!envKey) throw new Error(`Provider "${id}" is missing api_key_env.`);
      if (typ === 'openai_compatible' && !baseURL) throw new Error(`Provider "${id}" requires base_url.`);
      if (baseURL) {
        let u: URL;
        try {
          u = new URL(baseURL);
        } catch {
          throw new Error(`Provider "${id}" has invalid base_url.`);
        }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`Provider "${id}" base_url must be http/https.`);
        if (!u.hostname) throw new Error(`Provider "${id}" base_url host is missing.`);
      }
    }

    const defaultProviderID = defaultModel.slice(0, slash);
    if (!providerIDs.has(defaultProviderID)) throw new Error(`default_model references unknown provider "${defaultProviderID}".`);

    const models = Array.isArray(cfg.models) ? cfg.models : [];
    if (models.length > 0) {
      const modelIDs = new Set<string>();
      for (const m of models) {
        const id = String((m as any).id ?? '').trim();
        if (!id) throw new Error('Model id is required.');
        if (modelIDs.has(id)) throw new Error(`Duplicate model id: ${id}`);
        modelIDs.add(id);

        const idx = id.indexOf('/');
        if (idx <= 0 || idx >= id.length - 1) throw new Error(`Invalid model id "${id}" (expected "<provider>/<model>").`);
        const pid = id.slice(0, idx);
        if (!providerIDs.has(pid)) throw new Error(`Model "${id}" references unknown provider "${pid}".`);
      }
      if (!modelIDs.has(defaultModel)) throw new Error('default_model must be listed in models when models is set.');
    }
  };

  // Reset local state when settings are loaded (but do not overwrite user edits).
  createEffect(() => {
    const s = settings();
    if (!s) return;

    if (!runtimeDirty()) {
      const r = s.runtime;
      setRootDir(String(r?.root_dir ?? ''));
      setShell(String(r?.shell ?? ''));
      setRuntimeJSON(JSON.stringify({ root_dir: String(r?.root_dir ?? ''), shell: String(r?.shell ?? '') }, null, 2));
    }

    if (!loggingDirty()) {
      const l = s.logging;
      setLogFormat(String(l?.log_format ?? ''));
      setLogLevel(String(l?.log_level ?? ''));
      setLoggingJSON(JSON.stringify({ log_format: String(l?.log_format ?? ''), log_level: String(l?.log_level ?? '') }, null, 2));
    }

    if (!codespacesDirty()) {
      const c = s.codespaces;
      const min = Number(c?.code_server_port_min ?? 0);
      const max = Number(c?.code_server_port_max ?? 0);
      const n = normalizePortRange(min, max);

      // Treat invalid/empty config as "default".
      setUseDefaultCodePorts(n.is_default);
      setCodePortMin(n.is_default ? '' : n.effective_min);
      setCodePortMax(n.is_default ? '' : n.effective_max);
      setCodespacesJSON(JSON.stringify({ code_server_port_min: min, code_server_port_max: max }, null, 2));
    }

    if (!policyDirty()) {
      const p = s.permission_policy ?? defaultPermissionPolicy();
      setPolicyLocalRead(!!p.local_max?.read);
      setPolicyLocalWrite(!!p.local_max?.write);
      setPolicyLocalExecute(!!p.local_max?.execute);
      setPolicyByUser(mapToPermissionRows(p.by_user));
      setPolicyByApp(mapToPermissionRows(p.by_app));
      setPolicyJSON(JSON.stringify(p, null, 2));
    }

    if (!aiDirty()) {
      const a = s.ai ?? defaultAIConfig();
      setAiDefaultModel(String(a.default_model ?? ''));
      setAiProviders(
        (a.providers ?? []).map((p) => ({
          id: String(p.id ?? ''),
          type: p.type,
          base_url: String(p.base_url ?? ''),
          api_key_env: String(p.api_key_env ?? ''),
        })),
      );

      const models = Array.isArray(a.models) ? a.models : [];
      setAiUseModelList(models.length > 0);
      setAiModels(models.map((m) => ({ id: String(m.id ?? ''), label: String(m.label ?? '') })));

      setAiJSON(JSON.stringify(a, null, 2));
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

  const switchRuntimeView = (next: ViewMode) => {
    setRuntimeError(null);
    if (next === runtimeView()) return;
    if (next === 'json') {
      setRuntimeJSON(JSON.stringify(buildRuntimePatch(), null, 2));
      setRuntimeView('json');
      return;
    }
    try {
      const v = parseJSONOrThrow(runtimeJSON());
      if (!isJSONObject(v)) throw new Error('Runtime JSON must be an object.');
      if (typeof (v as any).root_dir !== 'string' || typeof (v as any).shell !== 'string') {
        throw new Error('Runtime JSON must include "root_dir" and "shell" as strings.');
      }
      setRootDir(String((v as any).root_dir ?? ''));
      setShell(String((v as any).shell ?? ''));
      setRuntimeView('ui');
    } catch (e) {
      setRuntimeError(e instanceof Error ? e.message : String(e));
    }
  };

  const switchLoggingView = (next: ViewMode) => {
    setLoggingError(null);
    if (next === loggingView()) return;
    if (next === 'json') {
      setLoggingJSON(JSON.stringify(buildLoggingPatch(), null, 2));
      setLoggingView('json');
      return;
    }
    try {
      const v = parseJSONOrThrow(loggingJSON());
      if (!isJSONObject(v)) throw new Error('Logging JSON must be an object.');
      if (typeof (v as any).log_format !== 'string' || typeof (v as any).log_level !== 'string') {
        throw new Error('Logging JSON must include "log_format" and "log_level" as strings.');
      }
      setLogFormat(String((v as any).log_format ?? ''));
      setLogLevel(String((v as any).log_level ?? ''));
      setLoggingView('ui');
    } catch (e) {
      setLoggingError(e instanceof Error ? e.message : String(e));
    }
  };

  const switchCodespacesView = (next: ViewMode) => {
    setCodespacesError(null);
    if (next === codespacesView()) return;
    if (next === 'json') {
      setCodespacesJSON(JSON.stringify(buildCodespacesPatch(), null, 2));
      setCodespacesView('json');
      return;
    }
    try {
      const v = parseJSONOrThrow(codespacesJSON());
      if (!isJSONObject(v)) throw new Error('Codespaces JSON must be an object.');
      const min = Number((v as any).code_server_port_min ?? NaN);
      const max = Number((v as any).code_server_port_max ?? NaN);
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        throw new Error('Codespaces JSON must include "code_server_port_min" and "code_server_port_max" as numbers.');
      }
      const n = normalizePortRange(min, max);
      setUseDefaultCodePorts(n.is_default);
      setCodePortMin(n.is_default ? '' : n.effective_min);
      setCodePortMax(n.is_default ? '' : n.effective_max);
      setCodespacesView('ui');
    } catch (e) {
      setCodespacesError(e instanceof Error ? e.message : String(e));
    }
  };

  const switchPolicyView = (next: ViewMode) => {
    setPolicyError(null);
    if (next === policyView()) return;
    if (next === 'json') {
      try {
        const v = buildPolicyValue();
        setPolicyJSON(JSON.stringify(v, null, 2));
      } catch {
        // Keep whatever is currently in the editor if we fail to build.
      }
      setPolicyView('json');
      return;
    }

    try {
      const v = parseJSONOrThrow(policyJSON());
      if (!isJSONObject(v)) throw new Error('Permission policy JSON must be an object.');
      if (Number((v as any).schema_version ?? 0) !== 1) throw new Error('schema_version must be 1.');
      const lm = (v as any).local_max;
      if (!isJSONObject(lm)) throw new Error('local_max is required.');

      const localRead = !!(lm as any).read;
      const localWrite = !!(lm as any).write;
      const localExec = !!(lm as any).execute;
      setPolicyLocalRead(localRead);
      setPolicyLocalWrite(localWrite);
      setPolicyLocalExecute(localExec);

      const byUserRaw = (v as any).by_user;
      const byAppRaw = (v as any).by_app;
      setPolicyByUser(mapToPermissionRows(isJSONObject(byUserRaw) ? (byUserRaw as any) : undefined));
      setPolicyByApp(mapToPermissionRows(isJSONObject(byAppRaw) ? (byAppRaw as any) : undefined));
      setPolicyView('ui');
    } catch (e) {
      setPolicyError(e instanceof Error ? e.message : String(e));
    }
  };

  const switchAIView = (next: ViewMode) => {
    setAiError(null);
    if (next === aiView()) return;
    if (next === 'json') {
      try {
        const v = buildAIValue();
        setAiJSON(JSON.stringify(v, null, 2));
      } catch {
        // Keep whatever is currently in the editor if we fail to build.
      }
      setAiView('json');
      return;
    }

    try {
      const v = parseJSONOrThrow(aiJSON());
      if (!isJSONObject(v)) throw new Error('AI JSON must be an object.');

      const dm = String((v as any).default_model ?? '').trim();
      const providersRaw = (v as any).providers;
      const modelsRaw = (v as any).models;

      if (!dm) throw new Error('AI JSON is missing default_model.');
      if (!Array.isArray(providersRaw)) throw new Error('AI JSON is missing providers[].');

      setAiDefaultModel(dm);
      setAiProviders(
        providersRaw.map((p) => ({
          id: String(p?.id ?? ''),
          type: String(p?.type ?? '') as AIProviderType,
          base_url: String(p?.base_url ?? ''),
          api_key_env: String(p?.api_key_env ?? ''),
        })),
      );

      const models = Array.isArray(modelsRaw) ? modelsRaw : [];
      setAiUseModelList(models.length > 0);
      setAiModels(models.map((m) => ({ id: String(m?.id ?? ''), label: String(m?.label ?? '') })));
      setAiView('ui');
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    }
  };

  const saveRuntime = async () => {
    setRuntimeError(null);
    setRuntimeSaving(true);
    try {
      const body = runtimeView() === 'json' ? parseJSONOrThrow(runtimeJSON()) : buildRuntimePatch();
      if (!isJSONObject(body)) throw new Error('Runtime JSON must be an object.');
      await saveSettings(body);
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

  const resetRuntime = () => {
    setRuntimeError(null);
    setRootDir('');
    setShell('');
    setRuntimeDirty(true);
    if (runtimeView() === 'json') setRuntimeJSON(JSON.stringify({ root_dir: '', shell: '' }, null, 2));
  };

  const saveLogging = async () => {
    setLoggingError(null);
    setLoggingSaving(true);
    try {
      const body = loggingView() === 'json' ? parseJSONOrThrow(loggingJSON()) : buildLoggingPatch();
      if (!isJSONObject(body)) throw new Error('Logging JSON must be an object.');
      await saveSettings(body);
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

  const resetLogging = () => {
    setLoggingError(null);
    setLogFormat('');
    setLogLevel('');
    setLoggingDirty(true);
    if (loggingView() === 'json') setLoggingJSON(JSON.stringify({ log_format: '', log_level: '' }, null, 2));
  };

  const saveCodespaces = async () => {
    setCodespacesError(null);
    setCodespacesSaving(true);
    try {
      let body: any = null;
      if (codespacesView() === 'json') {
        body = parseJSONOrThrow(codespacesJSON());
        if (!isJSONObject(body)) throw new Error('Codespaces JSON must be an object.');
      } else {
        if (!useDefaultCodePorts()) {
          const min = codePortMin();
          const max = codePortMax();
          if (min === '' || max === '') throw new Error('Please provide both port min and port max.');
          const n = normalizePortRange(Number(min), Number(max));
          if (n.is_default) throw new Error('Invalid port range.');
        }
        body = buildCodespacesPatch();
      }

      await saveSettings(body);
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

  const resetCodespaces = () => {
    setCodespacesError(null);
    setUseDefaultCodePorts(true);
    setCodePortMin('');
    setCodePortMax('');
    setCodespacesDirty(true);
    if (codespacesView() === 'json') {
      setCodespacesJSON(JSON.stringify({ code_server_port_min: 0, code_server_port_max: 0 }, null, 2));
    }
  };

  const savePolicy = async () => {
    setPolicyError(null);
    setPolicySaving(true);
    try {
      let body: any = null;
      if (policyView() === 'json') {
        const v = parseJSONOrThrow(policyJSON());
        if (!isJSONObject(v)) throw new Error('Permission policy JSON must be an object.');
        body = { permission_policy: v };
      } else {
        const v = buildPolicyValue();
        body = { permission_policy: v };
      }

      await saveSettings(body);
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

  const resetPolicy = () => {
    setPolicyError(null);
    const d = defaultPermissionPolicy();
    setPolicyLocalRead(d.local_max.read);
    setPolicyLocalWrite(d.local_max.write);
    setPolicyLocalExecute(d.local_max.execute);
    setPolicyByUser([]);
    setPolicyByApp([]);
    setPolicyDirty(true);
    if (policyView() === 'json') setPolicyJSON(JSON.stringify(d, null, 2));
  };

  const saveAI = async () => {
    setAiError(null);
    setAiSaving(true);
    try {
      let cfg: AIConfig | null = null;
      if (aiView() === 'json') {
        const v = parseJSONOrThrow(aiJSON());
        if (!isJSONObject(v)) throw new Error('AI JSON must be an object.');
        cfg = v as AIConfig;
      } else {
        cfg = buildAIValue();
      }
      validateAIValue(cfg);
      await saveSettings({ ai: cfg });
      setAiDirty(false);
      notify.success('Saved', aiEnabled() ? 'AI settings updated.' : 'AI has been enabled.');
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

  const resetAI = () => {
    setAiError(null);
    const d = defaultAIConfig();
    setAiDefaultModel(d.default_model);
    setAiProviders(d.providers.map((p) => ({ id: p.id, type: p.type, base_url: String(p.base_url ?? ''), api_key_env: p.api_key_env })));
    setAiUseModelList(false);
    setAiModels([]);
    setAiDirty(true);
    if (aiView() === 'json') setAiJSON(JSON.stringify(d, null, 2));
  };

  // When local max is tightened, clamp row-level caps to avoid confusing "true but ineffective" UI.
  createEffect(() => {
    const r = policyLocalRead();
    const w = policyLocalWrite();
    const x = policyLocalExecute();
    setPolicyByUser((prev) =>
      prev.map((it) => ({
        ...it,
        read: r ? it.read : false,
        write: w ? it.write : false,
        execute: x ? it.execute : false,
      })),
    );
    setPolicyByApp((prev) =>
      prev.map((it) => ({
        ...it,
        read: r ? it.read : false,
        write: w ? it.write : false,
        execute: x ? it.execute : false,
      })),
    );
  });

  const codespacesEffective = createMemo(() => {
    const s = settings();
    const min = Number(s?.codespaces?.code_server_port_min ?? 0);
    const max = Number(s?.codespaces?.code_server_port_max ?? 0);
    return normalizePortRange(min, max);
  });

  return (
    <div class="h-full min-h-0 overflow-auto">
      <div class="p-4 space-y-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-sm font-semibold">Settings</div>
            <div class="text-xs text-muted-foreground">AI changes apply immediately. Other changes require an agent restart.</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={settings.loading}>
            Refresh
          </Button>
        </div>

        <Show when={settings.error}>
          <div class="text-xs text-error break-words">{settings.error instanceof Error ? settings.error.message : String(settings.error)}</div>
        </Show>

        <Card>
          <div class="p-4 space-y-3">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="text-sm font-medium">Config file</div>
                <div class="text-xs text-muted-foreground">Read-only.</div>
              </div>
              <ViewToggle value={configView} onChange={(v) => setConfigView(v)} />
            </div>

            <Show when={configView() === 'ui'}>
              <div class="text-xs text-muted-foreground">
                Path: <code class="px-1 py-0.5 bg-muted rounded">{configPath() || '(unknown)'}</code>
              </div>
            </Show>

            <Show when={configView() === 'json'}>
              <textarea
                class="w-full h-[120px] font-mono text-xs border border-border rounded px-2 py-2 bg-background resize-y"
                value={configJSONText()}
                spellcheck={false}
                disabled={true}
              />
            </Show>
          </div>
        </Card>

        <Card>
          <div class="p-4 space-y-3">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="text-sm font-medium">Connection</div>
                <div class="text-xs text-muted-foreground">Read-only. Managed by the control plane.</div>
              </div>
              <ViewToggle value={connectionView} onChange={(v) => setConnectionView(v)} />
            </div>

            <Show when={connectionView() === 'ui'}>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                <div>
                  <div class="text-muted-foreground">Control plane</div>
                  <div class="font-mono break-all">{String(settings()?.connection?.controlplane_base_url ?? '')}</div>
                </div>
                <div>
                  <div class="text-muted-foreground">Environment ID</div>
                  <div class="font-mono break-all">{String(settings()?.connection?.environment_id ?? '')}</div>
                </div>
                <div>
                  <div class="text-muted-foreground">Agent instance ID</div>
                  <div class="font-mono break-all">{String(settings()?.connection?.agent_instance_id ?? '')}</div>
                </div>
                <div>
                  <div class="text-muted-foreground">Direct channel</div>
                  <div class="font-mono break-all">{String(settings()?.connection?.direct?.channel_id ?? '')}</div>
                </div>
                <div>
                  <div class="text-muted-foreground">Direct suite</div>
                  <div class="font-mono">{String(settings()?.connection?.direct?.default_suite ?? '')}</div>
                </div>
                <div>
                  <div class="text-muted-foreground">Init expire (unix_s)</div>
                  <div class="font-mono">{String(settings()?.connection?.direct?.channel_init_expire_at_unix_s ?? '')}</div>
                </div>
                <div class="md:col-span-2">
                  <div class="text-muted-foreground">Direct ws_url</div>
                  <div class="font-mono break-all">{String(settings()?.connection?.direct?.ws_url ?? '')}</div>
                </div>
                <div>
                  <div class="text-muted-foreground">E2EE PSK</div>
                  <div class="font-mono">{settings()?.connection?.direct?.e2ee_psk_set ? 'set' : 'missing'}</div>
                </div>
              </div>
            </Show>

            <Show when={connectionView() === 'json'}>
              <textarea
                class="w-full h-[220px] font-mono text-xs border border-border rounded px-2 py-2 bg-background resize-y"
                value={connectionJSONText()}
                spellcheck={false}
                disabled={true}
              />
            </Show>
          </div>
        </Card>

        <Card>
          <div class="p-4 space-y-3">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="text-sm font-medium">Runtime</div>
                <div class="text-xs text-muted-foreground">Restart required.</div>
              </div>
              <div class="flex items-center gap-2">
                <ViewToggle value={runtimeView} disabled={!canInteract()} onChange={(v) => switchRuntimeView(v)} />
                <Button size="sm" variant="outline" onClick={() => resetRuntime()} disabled={!canInteract()}>
                  Reset
                </Button>
                <Button size="sm" variant="default" onClick={() => void saveRuntime()} loading={runtimeSaving()} disabled={!canInteract()}>
                  Save
                </Button>
              </div>
            </div>

            <Show when={runtimeError()}>
              <div class="text-xs text-error break-words">{runtimeError()}</div>
            </Show>

            <Show when={runtimeView() === 'ui'}>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs font-medium mb-1">root_dir</label>
                  <Input
                    value={rootDir()}
                    onInput={(e) => {
                      setRootDir(e.currentTarget.value);
                      setRuntimeDirty(true);
                    }}
                    placeholder="(default: user home)"
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
                    placeholder="(default: $SHELL or /bin/bash)"
                    size="sm"
                    class="w-full"
                    disabled={!canInteract()}
                  />
                </div>
              </div>
            </Show>

            <Show when={runtimeView() === 'json'}>
              <textarea
                class="w-full h-[140px] font-mono text-xs border border-border rounded px-2 py-2 bg-background resize-y"
                value={runtimeJSON()}
                onInput={(e) => {
                  setRuntimeJSON(e.currentTarget.value);
                  setRuntimeDirty(true);
                }}
                spellcheck={false}
                disabled={!canInteract()}
              />
            </Show>
          </div>
        </Card>

        <Card>
          <div class="p-4 space-y-3">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="text-sm font-medium">Logging</div>
                <div class="text-xs text-muted-foreground">Restart required.</div>
              </div>
              <div class="flex items-center gap-2">
                <ViewToggle value={loggingView} disabled={!canInteract()} onChange={(v) => switchLoggingView(v)} />
                <Button size="sm" variant="outline" onClick={() => resetLogging()} disabled={!canInteract()}>
                  Reset
                </Button>
                <Button size="sm" variant="default" onClick={() => void saveLogging()} loading={loggingSaving()} disabled={!canInteract()}>
                  Save
                </Button>
              </div>
            </div>

            <Show when={loggingError()}>
              <div class="text-xs text-error break-words">{loggingError()}</div>
            </Show>

            <Show when={loggingView() === 'ui'}>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs font-medium mb-1">log_format</label>
                  <select
                    class="w-full text-xs border border-border rounded px-2 py-1 bg-background"
                    value={logFormat()}
                    onChange={(e) => {
                      setLogFormat(e.currentTarget.value);
                      setLoggingDirty(true);
                    }}
                    disabled={!canInteract()}
                  >
                    <option value="">Default (json)</option>
                    <option value="json">json</option>
                    <option value="text">text</option>
                  </select>
                </div>
                <div>
                  <label class="block text-xs font-medium mb-1">log_level</label>
                  <select
                    class="w-full text-xs border border-border rounded px-2 py-1 bg-background"
                    value={logLevel()}
                    onChange={(e) => {
                      setLogLevel(e.currentTarget.value);
                      setLoggingDirty(true);
                    }}
                    disabled={!canInteract()}
                  >
                    <option value="">Default (info)</option>
                    <option value="debug">debug</option>
                    <option value="info">info</option>
                    <option value="warn">warn</option>
                    <option value="error">error</option>
                  </select>
                </div>
              </div>
            </Show>

            <Show when={loggingView() === 'json'}>
              <textarea
                class="w-full h-[140px] font-mono text-xs border border-border rounded px-2 py-2 bg-background resize-y"
                value={loggingJSON()}
                onInput={(e) => {
                  setLoggingJSON(e.currentTarget.value);
                  setLoggingDirty(true);
                }}
                spellcheck={false}
                disabled={!canInteract()}
              />
            </Show>
          </div>
        </Card>

        <Card>
          <div class="p-4 space-y-3">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="text-sm font-medium">Codespaces</div>
                <div class="text-xs text-muted-foreground">Restart required.</div>
              </div>
              <div class="flex items-center gap-2">
                <ViewToggle value={codespacesView} disabled={!canInteract()} onChange={(v) => switchCodespacesView(v)} />
                <Button size="sm" variant="outline" onClick={() => resetCodespaces()} disabled={!canInteract()}>
                  Reset
                </Button>
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
            </div>

            <Show when={codespacesError()}>
              <div class="text-xs text-error break-words">{codespacesError()}</div>
            </Show>

            <Show when={codespacesView() === 'ui'}>
              <div class="text-xs text-muted-foreground">
                Default range: <code class="px-1 py-0.5 bg-muted rounded">{DEFAULT_CODE_SERVER_PORT_MIN}</code>-
                <code class="px-1 py-0.5 bg-muted rounded">{DEFAULT_CODE_SERVER_PORT_MAX}</code>. Effective:{' '}
                <code class="px-1 py-0.5 bg-muted rounded">{codespacesEffective().effective_min}</code>-
                <code class="px-1 py-0.5 bg-muted rounded">{codespacesEffective().effective_max}</code>.
              </div>

              <label class="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={useDefaultCodePorts()}
                  onChange={(e) => {
                    setUseDefaultCodePorts(e.currentTarget.checked);
                    setCodespacesDirty(true);
                  }}
                  disabled={!canInteract()}
                />
                Use default range
              </label>

              <Show when={!useDefaultCodePorts()}>
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
              </Show>
            </Show>

            <Show when={codespacesView() === 'json'}>
              <textarea
                class="w-full h-[140px] font-mono text-xs border border-border rounded px-2 py-2 bg-background resize-y"
                value={codespacesJSON()}
                onInput={(e) => {
                  setCodespacesJSON(e.currentTarget.value);
                  setCodespacesDirty(true);
                }}
                spellcheck={false}
                disabled={!canInteract()}
              />
            </Show>
          </div>
        </Card>

        <Card>
          <div class="p-4 space-y-3">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="text-sm font-medium">Permission policy</div>
                <div class="text-xs text-muted-foreground">Restart required.</div>
              </div>
              <div class="flex items-center gap-2">
                <ViewToggle value={policyView} disabled={!canInteract()} onChange={(v) => switchPolicyView(v)} />
                <Button size="sm" variant="outline" onClick={() => resetPolicy()} disabled={!canInteract()}>
                  Reset
                </Button>
                <Button size="sm" variant="default" onClick={() => void savePolicy()} loading={policySaving()} disabled={!canInteract()}>
                  Save
                </Button>
              </div>
            </div>

            <Show when={policyError()}>
              <div class="text-xs text-error break-words">{policyError()}</div>
            </Show>

            <Show when={policyView() === 'ui'}>
              <div class="text-xs text-muted-foreground">
                schema_version: <code class="px-1 py-0.5 bg-muted rounded">1</code>
              </div>

              <div class="space-y-2">
                <div class="text-xs font-medium">local_max</div>
                <div class="flex flex-wrap gap-4 text-xs">
                  <label class="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={policyLocalRead()}
                      onChange={(e) => {
                        setPolicyLocalRead(e.currentTarget.checked);
                        setPolicyDirty(true);
                      }}
                      disabled={!canInteract()}
                    />
                    read
                  </label>
                  <label class="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={policyLocalWrite()}
                      onChange={(e) => {
                        setPolicyLocalWrite(e.currentTarget.checked);
                        setPolicyDirty(true);
                      }}
                      disabled={!canInteract()}
                    />
                    write
                  </label>
                  <label class="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={policyLocalExecute()}
                      onChange={(e) => {
                        setPolicyLocalExecute(e.currentTarget.checked);
                        setPolicyDirty(true);
                      }}
                      disabled={!canInteract()}
                    />
                    execute
                  </label>
                </div>
                <div class="text-xs text-muted-foreground">by_user / by_app rules are AND-ed with local_max.</div>
              </div>

              <div class="space-y-2">
                <div class="flex items-center justify-between gap-2">
                  <div class="text-xs font-medium">by_user</div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPolicyByUser((prev) => [...prev, { key: '', read: policyLocalRead(), write: policyLocalWrite(), execute: policyLocalExecute() }]);
                      setPolicyDirty(true);
                    }}
                    disabled={!canInteract()}
                  >
                    Add
                  </Button>
                </div>
                <Show
                  when={policyByUser().length > 0}
                  fallback={<div class="text-xs text-muted-foreground">No user-specific overrides.</div>}
                >
                  <div class="space-y-2">
                    <For each={policyByUser()}>
                      {(row, idx) => (
                        <div class="border border-border rounded p-2 space-y-2">
                          <div class="flex items-center justify-between gap-2">
                            <div class="flex-1 min-w-0">
                              <label class="block text-xs font-medium mb-1">user_public_id</label>
                              <Input
                                value={row.key}
                                onInput={(e) => {
                                  const v = e.currentTarget.value;
                                  setPolicyByUser((prev) => prev.map((it, i) => (i === idx() ? { ...it, key: v } : it)));
                                  setPolicyDirty(true);
                                }}
                                placeholder="user_xxx"
                                size="sm"
                                class="w-full"
                                disabled={!canInteract()}
                              />
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setPolicyByUser((prev) => prev.filter((_, i) => i !== idx()));
                                setPolicyDirty(true);
                              }}
                              disabled={!canInteract()}
                            >
                              Remove
                            </Button>
                          </div>

                          <div class="flex flex-wrap gap-4 text-xs">
                            <label class="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={row.read}
                                onChange={(e) => {
                                  const v = e.currentTarget.checked;
                                  setPolicyByUser((prev) => prev.map((it, i) => (i === idx() ? { ...it, read: v } : it)));
                                  setPolicyDirty(true);
                                }}
                                disabled={!canInteract() || !policyLocalRead()}
                              />
                              read
                            </label>
                            <label class="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={row.write}
                                onChange={(e) => {
                                  const v = e.currentTarget.checked;
                                  setPolicyByUser((prev) => prev.map((it, i) => (i === idx() ? { ...it, write: v } : it)));
                                  setPolicyDirty(true);
                                }}
                                disabled={!canInteract() || !policyLocalWrite()}
                              />
                              write
                            </label>
                            <label class="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={row.execute}
                                onChange={(e) => {
                                  const v = e.currentTarget.checked;
                                  setPolicyByUser((prev) => prev.map((it, i) => (i === idx() ? { ...it, execute: v } : it)));
                                  setPolicyDirty(true);
                                }}
                                disabled={!canInteract() || !policyLocalExecute()}
                              />
                              execute
                            </label>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>

              <div class="space-y-2">
                <div class="flex items-center justify-between gap-2">
                  <div class="text-xs font-medium">by_app</div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPolicyByApp((prev) => [...prev, { key: '', read: policyLocalRead(), write: policyLocalWrite(), execute: policyLocalExecute() }]);
                      setPolicyDirty(true);
                    }}
                    disabled={!canInteract()}
                  >
                    Add
                  </Button>
                </div>
                <Show when={policyByApp().length > 0} fallback={<div class="text-xs text-muted-foreground">No app-specific overrides.</div>}>
                  <div class="space-y-2">
                    <For each={policyByApp()}>
                      {(row, idx) => (
                        <div class="border border-border rounded p-2 space-y-2">
                          <div class="flex items-center justify-between gap-2">
                            <div class="flex-1 min-w-0">
                              <label class="block text-xs font-medium mb-1">floe_app</label>
                              <Input
                                value={row.key}
                                onInput={(e) => {
                                  const v = e.currentTarget.value;
                                  setPolicyByApp((prev) => prev.map((it, i) => (i === idx() ? { ...it, key: v } : it)));
                                  setPolicyDirty(true);
                                }}
                                placeholder="redeven.env"
                                size="sm"
                                class="w-full"
                                disabled={!canInteract()}
                              />
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setPolicyByApp((prev) => prev.filter((_, i) => i !== idx()));
                                setPolicyDirty(true);
                              }}
                              disabled={!canInteract()}
                            >
                              Remove
                            </Button>
                          </div>

                          <div class="flex flex-wrap gap-4 text-xs">
                            <label class="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={row.read}
                                onChange={(e) => {
                                  const v = e.currentTarget.checked;
                                  setPolicyByApp((prev) => prev.map((it, i) => (i === idx() ? { ...it, read: v } : it)));
                                  setPolicyDirty(true);
                                }}
                                disabled={!canInteract() || !policyLocalRead()}
                              />
                              read
                            </label>
                            <label class="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={row.write}
                                onChange={(e) => {
                                  const v = e.currentTarget.checked;
                                  setPolicyByApp((prev) => prev.map((it, i) => (i === idx() ? { ...it, write: v } : it)));
                                  setPolicyDirty(true);
                                }}
                                disabled={!canInteract() || !policyLocalWrite()}
                              />
                              write
                            </label>
                            <label class="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={row.execute}
                                onChange={(e) => {
                                  const v = e.currentTarget.checked;
                                  setPolicyByApp((prev) => prev.map((it, i) => (i === idx() ? { ...it, execute: v } : it)));
                                  setPolicyDirty(true);
                                }}
                                disabled={!canInteract() || !policyLocalExecute()}
                              />
                              execute
                            </label>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>

            <Show when={policyView() === 'json'}>
              <textarea
                class="w-full h-[320px] font-mono text-xs border border-border rounded px-2 py-2 bg-background resize-y"
                value={policyJSON()}
                onInput={(e) => {
                  setPolicyJSON(e.currentTarget.value);
                  setPolicyDirty(true);
                }}
                spellcheck={false}
                disabled={!canInteract()}
              />
            </Show>
          </div>
        </Card>

        <div id="redeven-settings-ai">
          <Card>
            <div class="p-4 space-y-3">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <div class="text-sm font-medium">AI</div>
                  <div class="text-xs text-muted-foreground">
                    API keys are never stored. Use <code class="px-1 py-0.5 bg-muted rounded">api_key_env</code>.
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <ViewToggle value={aiView} disabled={!canInteract()} onChange={(v) => switchAIView(v)} />
                  <Button size="sm" variant="outline" onClick={() => resetAI()} disabled={!canInteract() || aiSaving()}>
                    Reset
                  </Button>
                  <Show when={aiEnabled()}>
                    <Button size="sm" variant="destructive" onClick={() => setDisableAIOpen(true)} disabled={!canInteract() || aiSaving()}>
                      Disable AI
                    </Button>
                  </Show>
                  <Button size="sm" variant="default" onClick={() => void saveAI()} loading={aiSaving()} disabled={!canInteract()}>
                    {aiEnabled() ? 'Save' : 'Enable AI'}
                  </Button>
                </div>
              </div>

              <Show when={!aiEnabled() && !settings.loading && !settings.error}>
                <div class="text-xs text-muted-foreground">
                  AI is currently disabled. Use “Enable AI” to save this config and activate the AI page.
                </div>
              </Show>

              <Show when={aiError()}>
                <div class="text-xs text-error break-words">{aiError()}</div>
              </Show>

              <Show when={aiView() === 'ui'}>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div class="md:col-span-2">
                    <label class="block text-xs font-medium mb-1">default_model</label>
                    <Input
                      value={aiDefaultModel()}
                      onInput={(e) => {
                        setAiDefaultModel(e.currentTarget.value);
                        setAiDirty(true);
                      }}
                      placeholder="openai/gpt-5-mini"
                      size="sm"
                      class="w-full"
                      disabled={!canInteract()}
                    />
                    <div class="mt-1 text-xs text-muted-foreground">Format: &lt;provider&gt;/&lt;model&gt;.</div>
                  </div>

                  <div class="md:col-span-2 space-y-2">
                    <div class="flex items-center justify-between gap-2">
                      <div class="text-xs font-medium">providers</div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setAiProviders((prev) => [...prev, { id: '', type: 'openai', base_url: '', api_key_env: '' }]);
                          setAiDirty(true);
                        }}
                        disabled={!canInteract()}
                      >
                        Add
                      </Button>
                    </div>

                    <For each={aiProviders()}>
                      {(p, idx) => (
                        <div class="border border-border rounded p-2 space-y-2">
                          <div class="flex items-center justify-between gap-2">
                            <div class="text-xs text-muted-foreground">Provider #{idx() + 1}</div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setAiProviders((prev) => prev.filter((_, i) => i !== idx()));
                                setAiDirty(true);
                              }}
                              disabled={!canInteract()}
                            >
                              Remove
                            </Button>
                          </div>

                          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <label class="block text-xs font-medium mb-1">id</label>
                              <Input
                                value={p.id}
                                onInput={(e) => {
                                  const v = e.currentTarget.value;
                                  setAiProviders((prev) => prev.map((it, i) => (i === idx() ? { ...it, id: v } : it)));
                                  setAiDirty(true);
                                }}
                                placeholder="openai"
                                size="sm"
                                class="w-full"
                                disabled={!canInteract()}
                              />
                            </div>
                            <div>
                              <label class="block text-xs font-medium mb-1">type</label>
                              <select
                                class="w-full text-xs border border-border rounded px-2 py-1 bg-background"
                                value={p.type}
                                onChange={(e) => {
                                  const v = e.currentTarget.value as AIProviderType;
                                  setAiProviders((prev) => prev.map((it, i) => (i === idx() ? { ...it, type: v } : it)));
                                  setAiDirty(true);
                                }}
                                disabled={!canInteract()}
                              >
                                <option value="openai">openai</option>
                                <option value="anthropic">anthropic</option>
                                <option value="openai_compatible">openai_compatible</option>
                              </select>
                            </div>
                            <div class="md:col-span-2">
                              <label class="block text-xs font-medium mb-1">base_url</label>
                              <Input
                                value={p.base_url}
                                onInput={(e) => {
                                  const v = e.currentTarget.value;
                                  setAiProviders((prev) => prev.map((it, i) => (i === idx() ? { ...it, base_url: v } : it)));
                                  setAiDirty(true);
                                }}
                                placeholder={p.type === 'openai_compatible' ? 'https://api.example.com/v1 (required)' : 'https://api.openai.com/v1'}
                                size="sm"
                                class="w-full"
                                disabled={!canInteract()}
                              />
                              <div class="mt-1 text-xs text-muted-foreground">
                                For openai_compatible, base_url is required. For openai/anthropic, base_url is optional.
                              </div>
                            </div>
                            <div class="md:col-span-2">
                              <label class="block text-xs font-medium mb-1">api_key_env</label>
                              <Input
                                value={p.api_key_env}
                                onInput={(e) => {
                                  const v = e.currentTarget.value;
                                  setAiProviders((prev) => prev.map((it, i) => (i === idx() ? { ...it, api_key_env: v } : it)));
                                  setAiDirty(true);
                                }}
                                placeholder="OPENAI_API_KEY"
                                size="sm"
                                class="w-full"
                                disabled={!canInteract()}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>

                  <div class="md:col-span-2 space-y-2">
                    <div class="flex items-center justify-between gap-2">
                      <div class="text-xs font-medium">models (optional allow-list)</div>
                      <label class="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={aiUseModelList()}
                          onChange={(e) => {
                            setAiUseModelList(e.currentTarget.checked);
                            setAiDirty(true);
                          }}
                          disabled={!canInteract()}
                        />
                        Use allow-list
                      </label>
                    </div>

                    <Show when={!aiUseModelList()}>
                      <div class="text-xs text-muted-foreground">When disabled, only default_model will be exposed.</div>
                    </Show>

                    <Show when={aiUseModelList()}>
                      <div class="flex items-center justify-between gap-2">
                        <div class="text-xs text-muted-foreground">Model ids must be in &lt;provider&gt;/&lt;model&gt; format.</div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setAiModels((prev) => [...prev, { id: '', label: '' }]);
                            setAiDirty(true);
                          }}
                          disabled={!canInteract()}
                        >
                          Add
                        </Button>
                      </div>

                      <Show when={aiModels().length > 0} fallback={<div class="text-xs text-muted-foreground">No models configured.</div>}>
                        <div class="space-y-2">
                          <For each={aiModels()}>
                            {(m, idx) => (
                              <div class="border border-border rounded p-2 space-y-2">
                                <div class="flex items-center justify-between gap-2">
                                  <div class="text-xs text-muted-foreground">Model #{idx() + 1}</div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setAiModels((prev) => prev.filter((_, i) => i !== idx()));
                                      setAiDirty(true);
                                    }}
                                    disabled={!canInteract()}
                                  >
                                    Remove
                                  </Button>
                                </div>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <div>
                                    <label class="block text-xs font-medium mb-1">id</label>
                                    <Input
                                      value={m.id}
                                      onInput={(e) => {
                                        const v = e.currentTarget.value;
                                        setAiModels((prev) => prev.map((it, i) => (i === idx() ? { ...it, id: v } : it)));
                                        setAiDirty(true);
                                      }}
                                      placeholder="openai/gpt-5-mini"
                                      size="sm"
                                      class="w-full"
                                      disabled={!canInteract()}
                                    />
                                  </div>
                                  <div>
                                    <label class="block text-xs font-medium mb-1">label</label>
                                    <Input
                                      value={m.label}
                                      onInput={(e) => {
                                        const v = e.currentTarget.value;
                                        setAiModels((prev) => prev.map((it, i) => (i === idx() ? { ...it, label: v } : it)));
                                        setAiDirty(true);
                                      }}
                                      placeholder="GPT-5 Mini"
                                      size="sm"
                                      class="w-full"
                                      disabled={!canInteract()}
                                    />
                                  </div>
                                </div>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    </Show>
                  </div>
                </div>
              </Show>

              <Show when={aiView() === 'json'}>
                <textarea
                  class="w-full h-[360px] font-mono text-xs border border-border rounded px-2 py-2 bg-background resize-y"
                  value={aiJSON()}
                  onInput={(e) => {
                    setAiJSON(e.currentTarget.value);
                    setAiDirty(true);
                  }}
                  spellcheck={false}
                  disabled={!canInteract()}
                />
              </Show>
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

