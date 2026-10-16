export const REMOTE_DESKTOP_DEPLOYMENT_CHANNEL = 'redeven-desktop:remote-desktop-deployment';
export const REMOTE_DESKTOP_DEPLOYMENT_PROGRESS = 'redeven-desktop:remote-desktop-deployment-progress';
export type DesktopDeploymentOperation = 'ensure' | 'stop' | 'uninstall';
export type DesktopAdministratorMethod = 'sudo' | 'root';
export type DesktopDeploymentRequest = {
    action: 'capabilities';
} | {
    action: 'cancel';
    operationId: string;
} | {
    action: 'respond';
    operationId: string;
    challengeId: string;
    confirmed?: true;
    administratorPassword?: string;
} | {
    action: 'manage';
    operationId: string;
    operation: DesktopDeploymentOperation;
    confirmed: true;
    administratorMethod: DesktopAdministratorMethod;
};
export type DesktopDeploymentProgress = Readonly<{
    operation_id: string;
    stage: 'checking' | 'preparing_media' | 'transferring' | 'authorization_required' | 'authorized' | 'confirmation_required' | 'verification_required' | 'recovering' | 'verifying_files' | 'installing_service' | 'starting_service' | 'stopping_service' | 'rolling_back' | 'rolled_back' | 'complete' | 'failed';
    challenge_id?: string;
    policy_digest?: string;
    service_generation?: string;
    active_connections?: number;
    administrator_method?: DesktopAdministratorMethod;
    host?: string;
    ssh_user?: string;
    received_bytes?: number;
    expected_bytes?: number;
    rollback?: 'complete' | 'failed';
}>;
export type DesktopDeploymentResult = Readonly<{
    ok: boolean;
    operation_id?: string;
    available?: boolean;
    host?: string;
    ssh_user?: string;
    state?: 'active' | 'stopped' | 'not_installed';
    code?: string;
    rollback?: 'complete' | 'failed' | 'unknown';
}>;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/u.test(value);
export function parseDesktopDeploymentRequest(value: unknown): DesktopDeploymentRequest | undefined {
    if (!value || typeof value !== 'object')
        return;
    const request = value as DesktopDeploymentRequest;
    if (request.action === 'capabilities')
        return { action: 'capabilities' };
    if (!('operationId' in request) || !identifier(request.operationId))
        return;
    if (request.action === 'cancel')
        return { action: 'cancel', operationId: request.operationId };
    if (request.action === 'respond') {
        if (!identifier(request.challengeId))
            return;
        if (request.administratorPassword !== undefined && (typeof request.administratorPassword !== 'string' || !request.administratorPassword || credentialByteLength(request.administratorPassword) > 4096 || /[\0\r\n]/u.test(request.administratorPassword)))
            return;
        if ((request.confirmed === true) === (request.administratorPassword !== undefined))
            return;
        return { action: 'respond', operationId: request.operationId, challengeId: request.challengeId, ...(request.confirmed ? { confirmed: true } : { administratorPassword: request.administratorPassword }) };
    }
    if (request.action !== 'manage' || request.confirmed !== true || !['ensure', 'stop', 'uninstall'].includes(request.operation) || !['sudo', 'root'].includes(request.administratorMethod))
        return;
    return { action: 'manage', operationId: request.operationId, operation: request.operation, confirmed: true, administratorMethod: request.administratorMethod };
}
function credentialByteLength(value: string): number { return new TextEncoder().encode(value).length; }
export function parseDesktopDeploymentProgress(value: unknown): DesktopDeploymentProgress | undefined {
    if (!value || typeof value !== 'object')
        return;
    const event = value as DesktopDeploymentProgress;
    if (!identifier(event.operation_id) || !['checking', 'preparing_media', 'transferring', 'authorization_required', 'authorized', 'confirmation_required', 'verification_required', 'recovering', 'verifying_files', 'installing_service', 'starting_service', 'stopping_service', 'rolling_back', 'rolled_back', 'complete', 'failed'].includes(event.stage))
        return;
    if (event.rollback !== undefined && !['complete', 'failed'].includes(event.rollback))
        return;
    for (const key of ['received_bytes', 'expected_bytes', 'active_connections'] as const) {
        if (event[key] !== undefined && (!Number.isSafeInteger(event[key]) || Number(event[key]) < 0 || Number(event[key]) > 2 ** 32))
            return;
    }
    if (event.challenge_id !== undefined && !identifier(event.challenge_id))
        return;
    if (event.policy_digest !== undefined && !/^[a-f0-9]{64}$/u.test(event.policy_digest))
        return;
    if (event.service_generation !== undefined && !identifier(event.service_generation))
        return;
    if (event.administrator_method !== undefined && !['sudo', 'root'].includes(event.administrator_method))
        return;
    for (const identity of [event.host, event.ssh_user])
        if (identity !== undefined && (typeof identity !== 'string' || identity.length > 256 || /[\0\r\n]/u.test(identity)))
            return;
    return { operation_id: event.operation_id, stage: event.stage,
        ...(event.administrator_method ? { administrator_method: event.administrator_method } : {}), ...(event.host ? { host: event.host } : {}), ...(event.ssh_user ? { ssh_user: event.ssh_user } : {}),
        ...(event.challenge_id ? { challenge_id: event.challenge_id } : {}), ...(event.policy_digest ? { policy_digest: event.policy_digest } : {}),
        ...(event.service_generation ? { service_generation: event.service_generation } : {}), ...(event.active_connections !== undefined ? { active_connections: event.active_connections } : {}),
        ...(event.received_bytes !== undefined ? { received_bytes: event.received_bytes } : {}), ...(event.expected_bytes !== undefined ? { expected_bytes: event.expected_bytes } : {}), ...(event.rollback ? { rollback: event.rollback } : {}) };
}
