import { createHash, randomUUID } from 'node:crypto';
import type { DesktopSSHTransportLease } from './sshTransportManager';
import { parseDesktopDeploymentProgress, type DesktopAdministratorMethod, type DesktopDeploymentRequest, type DesktopDeploymentOperation, type DesktopDeploymentProgress, type DesktopDeploymentResult } from '../shared/remoteDesktopDeployment';
export type DesktopServiceKit = Readonly<{
    files: ReadonlyMap<string, Buffer>;
    serviceSHA256: string;
    workerSHA256: string;
}>;
export type DesktopDeploymentHost = Readonly<{
    lease: DesktopSSHTransportLease;
    runtimePID: number;
    runtimeUID: number;
    runtimeGID: number;
    runtimeStart: string;
    runtimeSHA256: string;
    verifyRuntime: (operationId: string, challengeId: string, policyDigest: string, signal: AbortSignal) => Promise<void>;
    loadKit: (architecture: 'amd64' | 'arm64', signal: AbortSignal) => Promise<DesktopServiceKit>;
}>;
type DesktopDeploymentHostSource = DesktopDeploymentHost | ((signal: AbortSignal) => Promise<DesktopDeploymentHost>);
export class DesktopDeploymentPermissionError extends Error {
    constructor() { super('Desktop deployment permission denied'); }
}
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const sha256 = /^[a-f0-9]{64}$/u;
// Credentials belong only to this SSH transaction. Runtime APIs, daemon input,
// command arguments and diagnostics must never receive them.
type Operation = {
    id: string;
    controller: AbortController;
    finished: Promise<DesktopDeploymentResult>;
    challenge?: {
        id: string;
        kind: 'password' | 'confirmation';
        resolve: (value: Buffer | true) => void;
        reject: (error: Error) => void;
    };
};
export class RemoteDesktopDeployment {
    private readonly operations = new Map<number, Operation>();
    async cancel(owner: number, operationId?: string): Promise<void> {
        const operation = this.operations.get(owner);
        if (operation && (!operationId || operation.id === operationId)) {
            operation.controller.abort();
            await operation.finished;
        }
    }
    respond(owner: number, response: Extract<DesktopDeploymentRequest, {
        action: 'respond';
    }>): DesktopDeploymentResult {
        const operation = this.operations.get(owner), challenge = operation?.challenge;
        if (!operation || operation.id !== response.operationId || !challenge || challenge.id !== response.challengeId || (challenge.kind === 'password') !== (response.administratorPassword !== undefined))
            return { ok: false, code: 'challenge_expired' };
        operation.challenge = undefined;
        challenge.resolve(challenge.kind === 'password' ? Buffer.from(response.administratorPassword ?? '', 'utf8') : true);
        return { ok: true, operation_id: operation.id };
    }
    async dispose(): Promise<void> { await Promise.allSettled([...this.operations.keys()].map(owner => this.cancel(owner))); }
    async manage(owner: number, source: DesktopDeploymentHostSource, request: Extract<DesktopDeploymentRequest, {
        action: 'manage';
    }>, report: (event: DesktopDeploymentProgress) => void): Promise<DesktopDeploymentResult> {
        if (this.operations.has(owner))
            return { ok: false, code: 'operation_in_progress' };
        const operation: Operation = { id: request.operationId, controller: new AbortController(), finished: Promise.resolve({ ok: false }) };
        this.operations.set(owner, operation);
        operation.finished = this.execute(source, request.operation, request.administratorMethod, operation, report);
        try {
            return { ...await operation.finished, operation_id: operation.id };
        }
        finally {
            operation.challenge = undefined;
            if (this.operations.get(owner) === operation)
                this.operations.delete(owner);
        }
    }
    private challenge(operation: Operation, event: DesktopDeploymentProgress, report: (event: DesktopDeploymentProgress) => void, kind: 'password' | 'confirmation'): Promise<Buffer | true> {
        if (operation.challenge)
            return Promise.reject(new Error('challenge_in_progress'));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => finish(new Error('challenge_timeout')), 120000);
            const abort = () => finish(new Error('canceled'));
            const finish = (error?: Error, value?: Buffer | true) => { clearTimeout(timer); operation.controller.signal.removeEventListener('abort', abort); operation.challenge = undefined; if (error)
                reject(error);
            else
                resolve(value!); };
            operation.challenge = { id: event.challenge_id!, kind, resolve: value => finish(undefined, value), reject: error => finish(error) };
            operation.controller.signal.addEventListener('abort', abort, { once: true });
            if (operation.controller.signal.aborted)
                abort();
            else
                report(event);
        });
    }
    private async execute(source: DesktopDeploymentHostSource, operation: DesktopDeploymentOperation, method: DesktopAdministratorMethod, state: Operation, emit: (event: DesktopDeploymentProgress) => void): Promise<DesktopDeploymentResult> {
        const signal = state.controller.signal, operationId = state.id;
        const report = (event: Omit<DesktopDeploymentProgress, 'operation_id'>) => emit({ ...event, operation_id: operationId });
        let directory = '', privilegedStarted = false;
        let rollback: DesktopDeploymentResult['rollback'];
        let host: DesktopDeploymentHost | undefined;
        try {
            report({ stage: 'checking' });
            host = typeof source === 'function' ? await source(signal) : source;
            signal.throwIfAborted();
            if (!Number.isSafeInteger(host.runtimePID) || host.runtimePID <= 0)
                return { ok: false, code: 'invalid_request' };
            // Identity comes from the authenticated live Runtime, never renderer
            // paths or cross-user proc access. The root manager rechecks it.
            const probe = await host.lease.run('uname -s; uname -m; id -un; hostname', { signal, timeout_ms: 10000 });
            const lines = probe.stdout.trim().split('\n');
            const architecture = lines[1] === 'x86_64' ? 'amd64' : lines[1] === 'aarch64' ? 'arm64' : undefined;
            const {runtimeUID, runtimeGID, runtimeStart, runtimeSHA256} = host;
            if (probe.exit_code !== 0 || lines.length !== 4 || lines[0] !== 'Linux' || !architecture || !sha256.test(runtimeSHA256))
                return { ok: false, code: 'unsupported_target' };
            if (!runtimeStart || !/^\d+$/u.test(runtimeStart))
                return { ok: false, code: 'runtime_identity_changed' };
            const sshUser = lines[2], sshHost = lines[3];
            if (!sshUser || !sshHost || /[\0\r]/u.test(sshUser + sshHost))
                return { ok: false, code: 'unsupported_target' };
            if (!Number.isSafeInteger(runtimeUID) || runtimeUID < 0 || runtimeUID > 2 ** 32 - 1 || !Number.isSafeInteger(runtimeGID) || runtimeGID < 0 || runtimeGID > 2 ** 32 - 1)
                return { ok: false, code: 'unsupported_target' };
            const kit = await host.loadKit(architecture, signal);
            if (!sha256.test(kit.serviceSHA256) || !sha256.test(kit.workerSHA256)
                || digest(kit.files.get('floe-host-desktop-service') ?? Buffer.alloc(0)) !== kit.serviceSHA256
                || digest(kit.files.get('desktop-drm') ?? Buffer.alloc(0)) !== kit.workerSHA256)
                return { ok: false, code: 'deployment_failed' };
            const temporary = await host.lease.run('umask 077; mktemp -d /tmp/redeven-desktop-ssh-XXXXXX', { signal, timeout_ms: 10000 });
            directory = temporary.stdout.trim();
            if (temporary.exit_code !== 0 || !/^\/tmp\/redeven-desktop-ssh-[A-Za-z0-9]{6}$/u.test(directory)) {
                directory = '';
                return { ok: false, code: 'deployment_failed' };
            }
            report({ stage: 'transferring' });
            for (const name of ['floe-host-desktop-service', 'desktop-drm', 'libdrmtap.LICENSE', ...(operation === 'ensure' ? ['redeven'] : [])]) {
                const data = kit.files.get(name);
                if (!data || data.length === 0 || data.length > (name === 'redeven' ? 512 << 20 : 128 << 20))
                    return { ok: false, code: 'deployment_failed' };
                const uploaded = await host.lease.run(`cat > ${quote(`${directory}/${name}`)}`, { stdinData: data, signal, timeout_ms: 20 * 60000, stdin_progress_timeout_ms: 30000 });
                if (uploaded.exit_code !== 0)
                    return { ok: false, code: 'deployment_failed' };
            }
            let mediaSHA256: string | undefined;
            if (operation === 'ensure') {
                report({ stage: 'preparing_media' });
                const preparation = host.lease.stream(`chmod 0700 -- ${quote(`${directory}/redeven`)}; ${quote(`${directory}/redeven`)} desktop-service-media --cache "$HOME/.cache/redeven/desktop-service-media" --output ${quote(`${directory}/media.tar.gz`)}`, { signal, timeout_ms: 20 * 60000 });
                const completion = preparation.closed.then(() => undefined, error => error);
                let pending = '', invalid = false;
                preparation.stdout.setEncoding('utf8');
                preparation.stdout.on('data', (chunk: string) => {
                    pending += chunk;
                    if (pending.length > 32 * 1024) {
                        invalid = true;
                        preparation.kill('SIGTERM');
                        return;
                    }
                    let newline: number;
                    while ((newline = pending.indexOf('\n')) >= 0) {
                        const line = pending.slice(0, newline);
                        pending = pending.slice(newline + 1);
                        try {
                            const value = JSON.parse(line);
                            if (value.media_sha256 !== undefined) {
                                if (mediaSHA256 || !sha256.test(value.media_sha256))
                                    throw new Error('Invalid media digest');
                                mediaSHA256 = value.media_sha256;
                            }
                            else {
                                const event = parseDesktopDeploymentProgress({ operation_id: operationId, stage: 'preparing_media', received_bytes: value.received_bytes, expected_bytes: value.expected_bytes });
                                if (!event)
                                    throw new Error('Invalid media progress');
                                report(event);
                            }
                        }
                        catch {
                            invalid = true;
                            preparation.kill('SIGTERM');
                        }
                    }
                });
                preparation.stdin.end();
                const prepared = await preparation.result;
                if (await completion || invalid || pending || prepared.exit_code !== 0 || !mediaSHA256)
                    return { ok: false, code: signal.aborted ? 'canceled' : 'deployment_failed' };
                signal.throwIfAborted();
            }
            const request = { version: 2, operation_id: operationId, operation, source_directory: directory, runtime_pid: host.runtimePID, runtime_start: runtimeStart, runtime_uid: runtimeUID, runtime_gid: runtimeGID, runtime_sha256: runtimeSHA256, service_sha256: kit.serviceSHA256, worker_sha256: kit.workerSHA256, ...(mediaSHA256 ? { media_sha256: mediaSHA256 } : {}) };
            const result = await this.runManager(host, directory, kit.serviceSHA256, request, method, state, sshUser, sshHost, emit, () => { privilegedStarted = true; }, value => { rollback = value; });
            return { ...result, ...(rollback ? { rollback } : privilegedStarted && !result.ok ? { rollback: result.rollback ?? 'unknown' } : {}) };
        }
        catch (error) {
            return { ok: false, code: signal.aborted ? 'canceled' : error instanceof DesktopDeploymentPermissionError ? 'permission_denied' : 'transport_interrupted', ...(privilegedStarted ? { rollback: rollback ?? 'unknown' } : {}) };
        }
        finally {
            if (directory && host)
                await host.lease.run(`rm -rf -- ${quote(directory)}`, { timeout_ms: 10000 }).catch(() => { });
        }
    }
    private async runManager(host: DesktopDeploymentHost, directory: string, serviceDigest: string, request: Record<string, unknown>, method: DesktopAdministratorMethod, state: Operation, sshUser: string, sshHost: string, report: (event: DesktopDeploymentProgress) => void, authorizedCallback: () => void, rollbackCallback: (value: DesktopDeploymentResult['rollback']) => void): Promise<DesktopDeploymentResult> {
        const signal = state.controller.signal, operationId = state.id, marker = 'RDV-' + randomUUID(), prompt = marker + ':';
        const bootstrap = `set -eu; umask 077; stage=$(mktemp -d /usr/lib/redeven-desktop-authorize-XXXXXX); trap 'rm -rf -- "$stage"' EXIT; install -m 0700 -- ${quote(directory + '/floe-host-desktop-service')} "$stage/manage"; printf '%s  %s\\n' ${quote(serviceDigest)} "$stage/manage" | sha256sum -c - >/dev/null; printf '%s\\n' '{"stage":"authorized"}'; "$stage/manage" manage`;
        const elevated = method === 'root' ? `su -s /bin/sh -c ${quote(bootstrap)} root` : `sudo -S -p ${quote(prompt)} -- /bin/sh -c ${quote(bootstrap)}`;
        const command = method === 'root'
            ? `set -e; stty -echo -icanon min 1 time 0 -onlcr; printf '%s %s\\n' ${quote(marker)} "$(tty)"; if [ "$(id -u)" = 0 ]; then /bin/sh -c ${quote(bootstrap)}; else LC_ALL=C ${elevated}; fi`
            : `if [ "$(id -u)" = 0 ]; then /bin/sh -c ${quote(bootstrap)}; else LC_ALL=C ${elevated}; fi`;
        const stream = host.lease.stream(command, { pty: method === 'root', sensitive: true, timeout_ms: 7 * 60000 });
        const completion = stream.closed.then(() => undefined, error => error);
        let lastMessage = Date.now();
        let pending = '', errorPending = '', tty = '', authorized = false, sent = false, invalid = false, responding = false, finished = false;
        let verificationStarted = false, verified = false, cancelRequested = false;
        let releaseBound!: () => void;
        const bounded = new Promise<void>(resolve => { releaseBound = resolve; });
        let result: DesktopDeploymentResult | undefined, heartbeat: ReturnType<typeof setInterval> | undefined, cleanup: ReturnType<typeof setTimeout> | undefined;
        const send = (action: string, extra: Record<string, unknown> = {}) => { if (!finished && !stream.stdin.destroyed)
            stream.stdin.write(JSON.stringify({ version: 2, operation_id: operationId, action, ...extra }) + '\n'); };
        const abort = () => {
            if (finished)
                return;
            cancelRequested = true;
            if (heartbeat)
                clearInterval(heartbeat);
            if (authorized)
                send('cancel');
            else
                stream.kill('SIGTERM');
            // A lost cancel may first require the manager's 15-second liveness
            // deadline, then its independent 20-second rollback window.
            cleanup ??= setTimeout(() => { stream.kill('SIGTERM'); releaseBound(); }, 40000);
        };
        const fail = () => { invalid = true; abort(); };
        const password = async () => {
            if (sent || responding || authorized || signal.aborted) {
                fail();
                return;
            }
            responding = true;
            try {
                if (method === 'root') {
                    if (!/^\/dev\/pts\/\d+$/u.test(tty))
                        throw new Error('authentication_challenge_unsupported');
                    const echo = await host.lease.run(`stty -F ${quote(tty)} -a`, { signal, timeout_ms: 10000 });
                    if (echo.exit_code !== 0 || !/(?:^|[;\s])-echo(?:[;\s]|$)/u.test(echo.stdout) || /(?:^|[;\s])echo(?:[;\s]|$)/u.test(echo.stdout))
                        throw new Error('authentication_challenge_unsupported');
                }
                const value = await this.challenge(state, { operation_id: operationId, stage: 'authorization_required', challenge_id: randomUUID(), administrator_method: method, host: sshHost, ssh_user: sshUser }, report, 'password');
                if (value === true || signal.aborted || finished) {
                    if (value !== true)
                        value.fill(0);
                    fail();
                    return;
                }
                sent = true;
                const bytes = Buffer.concat([value, Buffer.from('\n')]);
                value.fill(0);
                stream.stdin.write(bytes, () => bytes.fill(0));
            }
            catch {
                if (!finished) {
                    result = { ok: false, code: signal.aborted ? 'canceled' : 'authentication_challenge_unsupported' };
                    fail();
                }
            }
            finally {
                responding = false;
            }
        };
        const event = (value: unknown) => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                fail();
                return;
            }
            const item = value as Record<string, unknown>;
            if (item.stage === 'authorized') {
                if (authorized || signal.aborted || cancelRequested) {
                    fail();
                    return;
                }
                authorized = true;
                authorizedCallback();
                stream.stdin.write(JSON.stringify(request) + '\n');
                lastMessage = Date.now();
                heartbeat = setInterval(() => { if (Date.now() - lastMessage >= 15000) {
                    result ??= { ok: false, code: 'transport_interrupted' };
                    abort();
                }
                else
                    send('heartbeat'); }, 5000);
                report({ operation_id: operationId, stage: 'authorized' });
                return;
            }
            if (!authorized || item.operation_id !== operationId || finished) {
                fail();
                return;
            }
            if (item.stage === 'heartbeat') {
                lastMessage = Date.now();
                return;
            }
            lastMessage = Date.now();
            if (item.stage === 'result') {
                const status = item.status as {
                    state?: string;
                } | undefined;
                const serviceState = status?.state;
                const expected = request.operation === 'ensure' ? 'active' : request.operation === 'stop' ? 'stopped' : 'not_installed';
                if (!item.code && (serviceState !== expected || (request.operation === 'ensure' && !verified))) {
                    result ??= { ok: false, code: 'management_protocol_invalid' };
                    fail();
                    return;
                }
                const code = typeof item.code === 'string' && /^[a-z_]{1,80}$/u.test(item.code) ? item.code : 'deployment_failed';
                result ??= { ok: !item.code, state: serviceState as DesktopDeploymentResult['state'], ...(item.code ? { code: signal.aborted ? 'canceled' : code } : {}) };
                stream.stdin.end();
                return;
            }
            const progress = parseDesktopDeploymentProgress(value);
            if (!progress) {
                fail();
                return;
            }
            if (progress.rollback)
                rollbackCallback(progress.rollback);
            if (progress.stage === 'confirmation_required') {
                if (!progress.challenge_id || !progress.policy_digest) {
                    fail();
                    return;
                }
                void this.challenge(state, progress, report, 'confirmation').then(() => { if (!signal.aborted && !finished && !result && !cancelRequested)
                    send('confirm', { challenge_id: progress.challenge_id, policy_digest: progress.policy_digest }); }, () => abort());
            }
            else if (progress.stage === 'verification_required') {
                if (verificationStarted || state.challenge || !progress.challenge_id || !progress.policy_digest) {
                    fail();
                    return;
                }
                verificationStarted = true;
                report(progress);
                void host.verifyRuntime(operationId, progress.challenge_id, progress.policy_digest, signal).then(() => { if (!signal.aborted && !finished && !result && !cancelRequested) {
                    verified = true;
                    send('commit', { challenge_id: progress.challenge_id, policy_digest: progress.policy_digest });
                } }, () => { if (!finished && !result) {
                    result = { ok: false, code: 'runtime_authentication_failed' };
                    abort();
                } });
            }
            else
                report(progress);
        };
        stream.stdin.on('error', () => { });
        stream.stdout.setEncoding('utf8');
        stream.stderr.setEncoding('utf8');
        stream.stderr.on('data', (chunk: string) => {
            if (method === 'root') {
                if (chunk.trim()) {
                    result = { ok: false, code: sent ? 'authorization_failed' : 'authentication_challenge_unsupported' };
                    fail();
                }
                return;
            }
            errorPending += chunk;
            if (errorPending === prompt) {
                errorPending = '';
                void password();
            }
            else if (errorPending.length > 8192 || !prompt.startsWith(errorPending)) {
                result = { ok: false, code: sent ? 'authorization_failed' : 'authorization_unavailable' };
                fail();
            }
        });
        stream.stdout.on('data', (chunk: string) => {
            pending += chunk;
            if (pending.length > 32 * 1024) {
                fail();
                return;
            }
            if (method === 'root' && !authorized) {
                if (!tty) {
                    const newline = pending.indexOf('\n');
                    if (newline < 0)
                        return;
                    const first = pending.slice(0, newline).trim();
                    pending = pending.slice(newline + 1);
                    if (!first.startsWith(marker + ' ')) {
                        fail();
                        return;
                    }
                    tty = first.slice(marker.length + 1);
                }
                pending = pending.trimStart();
                if (pending === 'Password: ' || pending === 'Password:') {
                    pending = '';
                    if (sent) {
                        result = { ok: false, code: 'authorization_failed' };
                        fail();
                    }
                    else
                        void password();
                    return;
                }
                if (pending && !'Password: '.startsWith(pending) && !pending.startsWith('{')) {
                    result = { ok: false, code: sent ? 'authorization_failed' : 'authentication_challenge_unsupported' };
                    fail();
                    return;
                }
            }
            let newline: number;
            while ((newline = pending.indexOf('\n')) >= 0) {
                const line = pending.slice(0, newline).trim();
                pending = pending.slice(newline + 1);
                if (!line)
                    continue;
                try {
                    event(JSON.parse(line));
                }
                catch {
                    fail();
                }
            }
        });
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted)
            abort();
        const authDeadline = setTimeout(() => { if (!authorized) {
            result = { ok: false, code: 'authorization_timeout' };
            abort();
        } }, 120000);
        try {
            const closed = await Promise.race([stream.result, bounded.then(() => undefined)]);
            finished = true;
            state.challenge?.reject(new Error('challenge_expired'));
            const transportError = await Promise.race([completion, bounded.then(() => new Error('cleanup_timeout'))]);
            if (result && !result.ok)
                return result;
            // Only the manager knows whether commit or cancellation won. A
            // verified final result is authoritative; the UI still cancels opening.
            if (result?.ok && closed?.exit_code === 0 && !transportError && !invalid)
                return result;
            return { ok: false, code: signal.aborted ? 'canceled' : authorized ? 'transport_interrupted' : sent ? 'authorization_failed' : 'authorization_unavailable', ...(authorized ? { rollback: 'unknown' as const } : {}) };
        }
        finally {
            finished = true;
            state.challenge?.reject(new Error('challenge_expired'));
            clearTimeout(authDeadline);
            if (heartbeat)
                clearInterval(heartbeat);
            if (cleanup)
                clearTimeout(cleanup);
            signal.removeEventListener('abort', abort);
        }
    }
}
