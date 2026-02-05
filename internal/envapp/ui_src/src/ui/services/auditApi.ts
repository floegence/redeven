import { fetchGatewayJSON } from './gatewayApi';

export type AgentAuditEntry = {
  created_at: string;
  action: string;
  status: string;
  error?: string;

  channel_id?: string;

  env_public_id?: string;
  namespace_public_id?: string;

  user_public_id?: string;
  user_email?: string;

  floe_app?: string;
  session_kind?: string;
  code_space_id?: string;
  tunnel_url?: string;

  can_read: boolean;
  can_write: boolean;
  can_execute: boolean;
  can_admin: boolean;

  detail?: Record<string, any>;
};

export async function listAgentAuditLogs(limit = 200): Promise<AgentAuditEntry[]> {
  const qp = new URLSearchParams();
  qp.set('limit', String(limit));
  const out = await fetchGatewayJSON<{ entries: AgentAuditEntry[] }>(`/_redeven_proxy/api/audit/logs?${qp.toString()}`, {
    method: 'GET',
  });
  return Array.isArray(out?.entries) ? out.entries : [];
}
