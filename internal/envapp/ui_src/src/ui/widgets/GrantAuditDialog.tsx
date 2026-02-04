import { For, Show, createMemo, createResource } from 'solid-js';
import { useNotification } from '@floegence/floe-webapp-core';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';

import { getGrantAudits, type GrantAuditEntry } from '../services/controlplaneApi';

function fmtTime(iso: string): string {
  const raw = String(iso ?? '').trim();
  if (!raw) return '';
  try {
    return new Date(raw).toLocaleString();
  } catch {
    return raw;
  }
}

function formatPerm(e: GrantAuditEntry): string {
  const parts: string[] = [];
  if (e.can_read_files) parts.push('R');
  if (e.can_write_files) parts.push('W');
  if (e.can_execute) parts.push('X');
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

function formatActionPrimary(e: GrantAuditEntry): string {
  const kind = String(e.session_kind ?? '').trim();
  const codeSpaceID = String(e.code_space_id ?? '').trim();
  const label = kindLabel(kind);

  if (!codeSpaceID) return label;
  // Avoid redundant "Env UI (env-ui)".
  if ((kind === 'envapp_rpc' || kind === 'envapp_proxy') && codeSpaceID === 'env-ui') return label;
  return `${label} (${codeSpaceID})`;
}

function formatUserPrimary(e: GrantAuditEntry): string {
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

export function GrantAuditDialog(props: { open: boolean; envId: string; onClose: () => void }) {
  const notify = useNotification();

  const envId = createMemo(() => String(props.envId ?? '').trim());

  const [entries, { refetch }] = createResource<GrantAuditEntry[], string | null>(
    () => (props.open ? envId() || null : null),
    async (id) => (id ? getGrantAudits(id, 50) : []),
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
        <div class="text-xs text-muted-foreground">Recent grant events for this environment.</div>

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
                                  <button type="button" class="hover:underline" onClick={() => void copy('User ID', e.user_public_id)}>
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
                                <button type="button" class="hover:underline" onClick={() => void copy('Floe app', e.floe_app)}>
                                  {e.floe_app}
                                </button>
                              </div>
                            </div>
                          </td>
                          <td class="py-2 pr-2 whitespace-nowrap">{formatPerm(e)}</td>
                          <td class={`py-2 pr-2 whitespace-nowrap ${e.status === 'failure' ? 'text-error' : ''}`}>
                            {e.status}
                            <Show when={e.error_code}>
                              <span class="text-muted-foreground">{` (${e.error_code})`}</span>
                            </Show>
                          </td>
                          <td class="py-2 max-w-[280px]">
                            <div class="min-w-0">
                              <div class="font-mono truncate" title={e.channel_id}>
                                <button type="button" class="hover:underline" onClick={() => void copy('Channel ID', e.channel_id)}>
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
