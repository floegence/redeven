import { PluginPlatformClient, type FetchLike } from '@floegence/redevplugin-ui';
import { fetchAuthenticatedReDevPlugin, redevPluginAPIPath } from './pluginPlatform';
import type { ExternalPluginInspection, ReDevPluginRecord } from './pluginTypes';
export type AuthorArtifact = Readonly<{
  artifact_id: string;
  plugin_id: string;
  version: string;
  source_sha256: string;
  package_sha256: string;
  created_at: string;
  stages: readonly { name: string; status: string; detail?: string }[];
}>;
export type AuthorSnapshot = Readonly<{
  artifacts: readonly AuthorArtifact[];
  build?: {
    status: string;
    error?: string;
    stages: readonly { name: string; status: string }[];
    commands: readonly { arguments: readonly string[]; output: string; truncated: boolean }[];
  };
  preview: { artifact_id?: string; plugin_instance_id?: string; generation: number };
  plugins: readonly ReDevPluginRecord[];
}>;
export type AuthorInstallOperation = Readonly<{
  request_id: string;
  mutation_outcome: string;
  execution: {
    execution_id: string;
    plugin_instance_id: string;
    status: string;
    failure_code?: string;
    error?: { code?: string; message?: string };
  };
}>;
export const authorWorkspacePath = (id: string) => `${redevPluginAPIPath}/author/workspaces/${encodeURIComponent(id)}`;
async function request<T>(id: string, action: string, data?: unknown): Promise<T> {
  const response = await fetchAuthenticatedReDevPlugin(`${authorWorkspacePath(id)}/${action}`, {
    method: data === undefined ? 'GET' : 'POST',
    ...(data === undefined ? {} : { body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }),
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(
        result.message ?? result.error?.message ?? result.error ?? `Plugin author request failed (${response.status})`,
      ),
      {
        status: response.status,
        code: result.code ?? result.error?.code,
        mutationOutcome: result.error?.mutation_outcome ?? result.mutation_outcome,
      },
    );
  return result.data ?? result;
}
export function createAuthorPlatformClient(id: string): PluginPlatformClient {
  const fetch: FetchLike = (path, init) => {
    const url = new URL(path, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith(`${redevPluginAPIPath}/`))
      throw new TypeError('Invalid preview platform route');
    return fetchAuthenticatedReDevPlugin(`${authorWorkspacePath(id)}/platform${url.pathname}${url.search}`, init);
  };
  return new PluginPlatformClient({ fetch });
}
const loadCatalog = async (id: string) => (await createAuthorPlatformClient(id).catalog()).plugins;
export const authorStatus = async (id: string): Promise<AuthorSnapshot> => {
  const state = await request<Omit<AuthorSnapshot, 'plugins'>>(id, 'status');
  return { ...state, plugins: state.preview.plugin_instance_id ? await loadCatalog(id) : [] };
};
export const checkAuthorArtifact = (id: string, artifactID: string) =>
  request<ExternalPluginInspection>(id, 'check', { artifact_id: artifactID });
export const applyAuthorArtifact = async (id: string, artifactID: string): Promise<AuthorSnapshot> => ({
  ...(await request<Omit<AuthorSnapshot, 'plugins'>>(id, 'apply', { artifact_id: artifactID })),
  plugins: await loadCatalog(id),
});
export const inspectAuthorArtifact = (id: string, artifactID: string) =>
  request<ExternalPluginInspection>(id, 'inspect', { artifact_id: artifactID });
export const installAuthorArtifact = (
  id: string,
  artifactID: string,
  inspectionID: string,
  requestID: string,
  revision: number,
) =>
  request<AuthorInstallOperation>(id, 'install', {
    artifact_id: artifactID,
    inspection_id: inspectionID,
    request_id: requestID,
    revision,
  });
export const queryAuthorInstall = (id: string, requestID: string) =>
  request<AuthorInstallOperation>(id, 'installation', { request_id: requestID });
