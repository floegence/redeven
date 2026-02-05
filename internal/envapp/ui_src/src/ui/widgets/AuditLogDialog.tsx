import { For, Show, createMemo, createResource } from 'solid-js';
import { useNotification } from '@floegence/floe-webapp-core';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';

import { listAgentAuditLogs, type AgentAuditEntry } from '../services/auditApi';

function fmtTime(iso: string): string {
  const raw = String(iso ?? '').trim();
  if (!raw) return '';
  try {
    return new Date(raw).toLocaleString();
  } catch {
    return raw;
  }
}

function formatPerm(e: AgentAuditEntry): string {
  const parts: string[] = [];
  if (e.can_read) parts.push('R');
  if (e.can_write) parts.push('W');
  if (e.can_execute) parts.push('X');
  if (e.can_admin) parts.push('A');
  return parts.length > 0 ? parts.join('') : '-';
}

function kindLabel(kind: string): string {
  const v = String(kind ?? '').trim();
  switch (v) {
    case 'portal':
      return 'Portal';
    case 'envapp_rpc':
    case 'envapp_proxy':
      return 'Env UI';
    case 'codeapp':
      return 'Codespace';
    case 'portforward':
      return 'Port Forward';
    case 'app':
      return 'App';
    default:
      return v || '-';
  }
}

function actionLabel(action: string): string {
  const v = String(action ?? '').trim();
  switch (v) {
    case 'session_opened':
      return 'Session opened';
    case 'session_open_failed':
      return 'Session open failed';
    case 'session_open_canceled':
      return 'Session open canceled';
    case 'session_closed':
      return 'Session closed';
    case 'settings_update':
      return 'Settings updated';
    case 'codespace_create':
      return 'Codespace created';
    case 'codespace_update':
      return 'Codespace updated';
    case 'codespace_start':
      return 'Codespace started';
    case 'codespace_stop':
      return 'Codespace stopped';
    case 'codespace_delete':
      return 'Codespace deleted';
    case 'port_forward_create':
      return 'Port forward created';
    case 'port_forward_update':
      return 'Port forward updated';
    case 'port_forward_open':
      return 'Port forward opened';
    case 'port_forward_delete':
      return 'Port forward deleted';
    case 'ai_run':
      return 'AI run';
    case 'ai_run_cancel':
      return 'AI run canceled';
    case 'ai_tool_approval':
      return 'AI tool approval';
    case 'ai_upload':
      return 'AI upload';
    default:
      return v || '-';
  }
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m${secs}s`;
}

function formatActionPrimary(e: AgentAuditEntry): string {
  const label = actionLabel(e.action);
  const codeSpaceID = String(e.code_space_id ?? '').trim();
  if (!codeSpaceID) return label;
  if (codeSpaceID === 'env-ui') return label;
  return `${label} (${codeSpaceID})`;
}

function formatActionSecondary(e: AgentAuditEntry): string {
  const detail = e.detail ?? {};
  const action = String(e.action ?? '').trim();
  if (action === 'session_closed' || action === 'session_open_failed' || action === 'session_open_canceled') {
    const reason = String(detail.reason ?? '').trim();
    const dur = typeof detail.duration_ms === 'number' ? detail.duration_ms : null;
    const durText = dur != null ? formatDurationMs(dur) : '';
    if (reason && durText) return `Reason: ${reason} · ${durText}`;
    if (reason) return `Reason: ${reason}`;
    if (durText) return `Duration: ${durText}`;
    return '';
  }
  if (action === 'settings_update') {
    const updated: string[] = [];
    if (detail.root_dir) updated.push('root_dir');
    if (detail.shell) updated.push('shell');
    if (detail.log_format) updated.push('log_format');
    if (detail.log_level) updated.push('log_level');
    if (detail.code_server_port_min != null || detail.code_server_port_max != null) updated.push('code_server_ports');
    if (detail.permission_policy_updated) updated.push('permission_policy');
    if (detail.ai_updated) updated.push('ai');
    return updated.length > 0 ? `Updated: ${updated.join(', ')}` : '';
  }
  if (action === 'codespace_create') {
    const cs = String(detail.code_space_id ?? e.code_space_id ?? '').trim();
    const wp = String(detail.workspace_path ?? '').trim();
    if (cs && wp) return `${cs} · ${wp}`;
    if (cs) return cs;
    if (wp) return wp;
    return '';
  }
  if (action === 'codespace_start') {
    const port = detail.code_port;
    if (typeof port === 'number' && port > 0) return `Code port: ${port}`;
    return '';
  }
  if (action === 'port_forward_create' || action === 'port_forward_update') {
    const fid = String(detail.forward_id ?? '').trim();
    const host = String(detail.target_host ?? '').trim();
    if (fid && host) return `${fid} -> ${host}`;
    if (fid) return fid;
    if (host) return host;
    return '';
  }
  if (action === 'port_forward_delete') {
    const fid = String(detail.forward_id ?? '').trim();
    return fid || '';
  }
  if (action === 'ai_run') {
    const rid = String(detail.run_id ?? '').trim();
    const model = String(detail.model ?? '').trim();
    if (rid && model) return `${rid} · ${model}`;
    return rid || model;
  }
  if (action === 'ai_upload') {
    const name = String(detail.name ?? '').trim();
    const size = typeof detail.size === 'number' ? detail.size : null;
    if (name && size != null) return `${name} (${size} bytes)`;
    return name;
  }
  const reason = String(detail.reason ?? '').trim();
  if (reason) return `Reason: ${reason}`;
  return '';
}

function formatUserPrimary(e: AgentAuditEntry): string {
  const email = String(e.user_email ?? '').trim();
  if (email) return email;
  return String(e.user_public_id ?? '').trim();
}

function formatTunnelHost(tunnelURL: string): string {
  const raw = String(tunnelURL ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).host;
  } catch {
    return raw;
  }
}

function shortError(s: string): string {
  const v = String(s ?? '').trim();
  if (!v) return '';
  if (v.length <= 32) return v;
  return v.slice(0, 32) + '...';
}

export function AuditLogDialog(props: { open: boolean; envId: string; onClose: () => void }) {
  const notify = useNotification();

  const envId = createMemo(() => String(props.envId ?? '').trim());

  const [entries, { refetch }] = createResource<AgentAuditEntry[], string | null>(
    () => (props.open ? envId() || null : null),
    async (id) => {
      const all = await listAgentAuditLogs(200);
      const targetEnv = String(id ?? '').trim();
      if (!targetEnv) return all;
      return all.filter((e) => String(e.env_public_id ?? '').trim() === targetEnv);
    },
  );

  const errorText = createMemo(() => {
    const e = entries.error;
    if (!e) return '';
    return e instanceof Error ? e.message : String(e);
  });

  const copy = async (label: string, value: string) => {
    const v = String(value ?? '').trim();
    if (!v) return;
    try {
      await navigator.clipboard.writeText(v);
      notify.success('Copied', `${label} copied to clipboard`);
    } catch {
      notify.error('Copy failed', 'Clipboard permission denied');
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title="Audit log"
      footer={
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={entries.loading || !envId()}>
            Refresh
          </Button>
          <Button size="sm" variant="default" onClick={props.onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div class="space-y-2">
        <div class="text-xs text-muted-foreground">Recent events recorded by this agent.</div>

        <Show when={errorText()}>
          <div class="text-xs text-error break-words">{errorText()}</div>
        </Show>

        <div class="relative" style={{ 'min-height': '160px' }}>
          <LoadingOverlay visible={entries.loading} message="Loading audit log..." />

          <Show when={!entries.loading}>
            <Show when={(entries() ?? []).length > 0} fallback={<div class="text-xs text-muted-foreground">No audit entries.</div>}>
              <div class="max-h-[60vh] overflow-auto">
                <table class="w-full text-xs">
                  <thead class="text-muted-foreground">
                    <tr class="text-left">
                      <th class="py-2 pr-2 whitespace-nowrap">Time</th>
                      <th class="py-2 pr-2 whitespace-nowrap">User</th>
                      <th class="py-2 pr-2 whitespace-nowrap">Action</th>
                      <th class="py-2 pr-2 whitespace-nowrap">Perm</th>
                      <th class="py-2 pr-2 whitespace-nowrap">Status</th>
                      <th class="py-2 whitespace-nowrap">Channel</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={entries() ?? []}>
                      {(e) => (
                        <tr class="border-t border-border/60">
                          <td class="py-2 pr-2 whitespace-nowrap">{fmtTime(e.created_at)}</td>
                          <td class="py-2 pr-2 max-w-[240px]">
                            <div class="min-w-0">
                              <div class="truncate" title={formatUserPrimary(e)}>
                                <button type="button" class="hover:underline" onClick={() => void copy('User', formatUserPrimary(e))}>
                                  {formatUserPrimary(e) || '-'}
                                </button>
                              </div>
                              <Show when={String(e.user_email ?? '').trim() && String(e.user_public_id ?? '').trim()}>
                                <div class="text-muted-foreground font-mono truncate" title={e.user_public_id}>
                                  <button type="button" class="hover:underline" onClick={() => void copy('User ID', e.user_public_id ?? '')}>
                                    {e.user_public_id}
                                  </button>
                                </div>
                              </Show>
                            </div>
                          </td>
                          <td class="py-2 pr-2 max-w-[320px]">
                            <div class="min-w-0">
                              <div class="truncate" title={formatActionPrimary(e)}>
                                {formatActionPrimary(e)}
                              </div>
                              <div class="text-muted-foreground font-mono truncate" title={e.floe_app}>
                                <button type="button" class="hover:underline" onClick={() => void copy('Floe app', e.floe_app ?? '')}>
                                  {e.floe_app || '-'}
                                </button>
                              </div>
                              <Show when={String(formatActionSecondary(e) ?? '').trim()}>
                                <div class="text-muted-foreground truncate" title={formatActionSecondary(e)}>
                                  {formatActionSecondary(e)}
                                </div>
                              </Show>
                            </div>
                          </td>
                          <td class="py-2 pr-2 whitespace-nowrap">{formatPerm(e)}</td>
                          <td class={`py-2 pr-2 whitespace-nowrap ${e.status === 'failure' ? 'text-error' : ''}`}>
                            {e.status}
                            <Show when={String(e.error ?? '').trim()}>
                              <span class="text-muted-foreground" title={String(e.error ?? '').trim()}>
                                {` (${shortError(String(e.error ?? '').trim())})`}
                              </span>
                            </Show>
                          </td>
                          <td class="py-2 max-w-[280px]">
                            <div class="min-w-0">
                              <div class="font-mono truncate" title={e.channel_id}>
                                <button type="button" class="hover:underline" onClick={() => void copy('Channel ID', e.channel_id ?? '')}>
                                  {e.channel_id || '-'}
                                </button>
                              </div>
                              <Show when={String(e.tunnel_url ?? '').trim()}>
                                <div class="text-muted-foreground truncate" title={e.tunnel_url}>
                                  <button type="button" class="hover:underline" onClick={() => void copy('Tunnel URL', e.tunnel_url ?? '')}>
                                    {`Tunnel: ${formatTunnelHost(e.tunnel_url ?? '')}`}
                                  </button>
                                </div>
                              </Show>
                              <Show when={String(e.session_kind ?? '').trim()}>
                                <div class="text-muted-foreground truncate" title={e.session_kind}>
                                  {`Session: ${kindLabel(e.session_kind ?? '')}`}
                                </div>
                              </Show>
                            </div>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
          </Show>
        </div>
      </div>
    </Dialog>
  );
}
