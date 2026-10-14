/** Runtime identity shared by local Desktop and Env App surfaces. */
export const LOCAL_ENVIRONMENT_FLOWER_RUNTIME_ID = 'env:local-environment';

export function flowerRuntimeIDForEnvironment(envPublicID: string | undefined): string {
  const endpointID = envPublicID?.trim() || 'current';
  return endpointID === 'env_local' ? LOCAL_ENVIRONMENT_FLOWER_RUNTIME_ID : `env:${endpointID}`;
}
