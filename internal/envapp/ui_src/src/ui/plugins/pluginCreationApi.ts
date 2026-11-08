import { fetchSessionJSON } from '../services/sessionHTTP';
export type PluginDraft = Readonly<{
  id: string;
  title: string;
  icon_url?: string;
  revision: number;
  lifecycle: 'preparing' | 'active' | 'deleting' | 'deleted';
  launch_pending?: boolean;
  installed_plugin_id?: string;
  install_request_id?: string;
  install_artifact_id?: string;
  install_inspection_id?: string;
  workspace_id?: string;
  thread_id?: string;
  cleanup_stage?: string;
  created_at: number;
  updated_at: number;
}>;
export const pluginCreationAPI = '/_redeven_proxy/api/plugin-creation';
export const listPluginDrafts = () =>
  fetchSessionJSON<readonly PluginDraft[]>(`${pluginCreationAPI}/drafts`, { method: 'GET' });
export const getPluginDraft = (id: string) =>
  fetchSessionJSON<PluginDraft>(`${pluginCreationAPI}/drafts/${encodeURIComponent(id)}`, { method: 'GET' });
export const pluginDraftForThread = (id: string) =>
  fetchSessionJSON<PluginDraft>(`${pluginCreationAPI}/threads/${encodeURIComponent(id)}`, { method: 'GET' });
export const createPluginDraft = (requestID: string) =>
  fetchSessionJSON<PluginDraft>(`${pluginCreationAPI}/drafts`, {
    method: 'POST',
    body: JSON.stringify({ request_id: requestID }),
  });
export const deletePluginDraft = (draft: PluginDraft) =>
  fetchSessionJSON<PluginDraft>(`${pluginCreationAPI}/drafts/${encodeURIComponent(draft.id)}/delete`, {
    method: 'POST',
    body: JSON.stringify({ revision: draft.revision }),
  });
export const renamePluginDraft = (draft: PluginDraft, title: string) =>
  fetchSessionJSON<PluginDraft>(`${pluginCreationAPI}/drafts/${encodeURIComponent(draft.id)}/rename`, {
    method: 'POST',
    body: JSON.stringify({ revision: draft.revision, title }),
  });
export const resumePluginDraft = (id: string) =>
  fetchSessionJSON<PluginDraft>(`${pluginCreationAPI}/drafts/${encodeURIComponent(id)}/resume`, {
    method: 'POST',
    body: '{}',
  });
