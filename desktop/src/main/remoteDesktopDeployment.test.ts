import { createHash } from 'node:crypto';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { RemoteDesktopDeployment, DesktopDeploymentPermissionError } from './remoteDesktopDeployment';
import type { DesktopSSHCommandResult, DesktopSSHTransportLease } from './sshTransportManager';
import { parseDesktopDeploymentRequest, parseDesktopDeploymentProgress, type DesktopDeploymentProgress, type DesktopDeploymentOperation, type DesktopAdministratorMethod } from '../shared/remoteDesktopDeployment';
const operationId = 'fixture-operation', policyDigest = 'c'.repeat(64);
const request = (operation: DesktopDeploymentOperation = 'ensure', administratorMethod: DesktopAdministratorMethod = 'sudo') => ({ action: 'manage' as const, operationId, operation, confirmed: true as const, administratorMethod });
type Mode = 'nopasswd' | 'password' | 'reject' | 'cancel' | 'prepare_failure' | 'prepare_cancel' | 'confirmation' | 'proof_failure' | 'root' | 'echo' | 'late_proof' | 'duplicate_challenge' | 'duplicate_proof' | 'wrong_result' | 'hung_cancel' | 'stale_challenge' | 'root_multistage' | 'heartbeat_loss' | 'committed_cancel' | 'root_runtime';
function fixture(mode: Mode = 'nopasswd') {
    const commands: string[] = [], writes: string[] = [], progress: DesktopDeploymentProgress[] = [], streamOptions: object[] = [], credentialBuffers: Buffer[] = [];
    const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
    const service = Buffer.from('reviewed-service'), worker = Buffer.from('reviewed-worker');
    const kit = { serviceSHA256: sha(service), workerSHA256: sha(worker), files: new Map([['floe-host-desktop-service', service], ['desktop-drm', worker], ['libdrmtap.LICENSE', Buffer.from('license')], ['redeven', Buffer.from('verified-released-runtime')]]) };
    const manager = new RemoteDesktopDeployment();
    const done = (exit_code = 0, stdout = '') => ({ exit_code, stdout, stderr: '', signal: null } as DesktopSSHCommandResult);
    let settleProof: (() => void) | undefined;
    const verify = vi.fn(async () => { if (mode === 'proof_failure')
        throw new Error('Admission denied'); if (mode === 'late_proof' || mode === 'duplicate_proof' || mode === 'heartbeat_loss')
        await new Promise<void>(resolve => { settleProof = resolve; }); });
    const lease = {
        run: async (command: string) => {
            commands.push(command);
            if (mode === 'root_runtime' && command.includes('/proc/42')) return done(1);
            if (command.startsWith('uname'))
                return done(0, ['Linux', 'x86_64', 'tang', 'host.example'].join('\n') + '\n');
            if (command.startsWith('stty'))
                return done(0, mode === 'echo' ? 'echo; -icanon;' : '-echo; -icanon;');
            if (command.includes('mktemp'))
                return done(0, '/tmp/redeven-desktop-ssh-AbC123\n');
            return done();
        },
        stream: (command: string, options: {
            signal?: AbortSignal;
            pty?: boolean;
            sensitive?: boolean;
        } = {}) => {
            commands.push(command);
            streamOptions.push(options);
            const stdout = new PassThrough(), stderr = new PassThrough();
            let finish!: (value: DesktopSSHCommandResult) => void;
            const result = new Promise<DesktopSSHCommandResult>(resolve => { finish = resolve; });
            if (command.includes('desktop-service-media')) {
                options.signal?.addEventListener('abort', () => finish(done(1)), { once: true });
                const stdin = new Writable({ write(_data, _encoding, callback) { callback(); } });
                queueMicrotask(() => { stdout.write(JSON.stringify({ received_bytes: 5, expected_bytes: 10 }) + '\n'); if (mode !== 'prepare_cancel') {
                    stdout.write(JSON.stringify({ media_sha256: 'b'.repeat(64) }) + '\n');
                    finish(done(mode === 'prepare_failure' ? 1 : 0));
                } });
                return { stdin, stdout, stderr, result, closed: result.then(() => { }), kill: () => finish(done(1)) };
            }
            let accepted = !['password', 'reject', 'root', 'echo', 'root_multistage'].includes(mode), committed = false;
            const emit = (value: object) => stdout.write(JSON.stringify({ operation_id: operationId, ...value }) + '\n');
            const rollback = () => { emit({ stage: 'rolling_back' }); emit({ stage: 'rolled_back', rollback: 'complete' }); emit({ stage: 'result', code: 'deployment_failed' }); finish(done(1)); };
            const proof = () => emit({ stage: 'verification_required', challenge_id: 'proof', policy_digest: policyDigest });
            const stdin = new Writable({ write(data, _encoding, callback) {
                    const value = Buffer.from(data).toString();
                    writes.push(value);
                    if (!accepted)
                        credentialBuffers.push(data);
                    callback();
                    queueMicrotask(() => {
                        if (!accepted) {
                            if (mode === 'reject') {
                                finish(done(1));
                                return;
                            }
                            accepted = true;
                            emit({ stage: 'authorized' });
                            return;
                        }
                        const item = JSON.parse(value);
                        if (item.action === 'cancel') {
                            if (committed) return;
                            if(mode==='hung_cancel')return;
                            rollback();
                            return;
                        }
                        if (item.action === 'heartbeat')
                            return;
                        if (item.action === 'commit') {
                            committed = true;
                            if (mode === 'committed_cancel') void manager.cancel(1, operationId);
                            emit({ stage: 'result', status: { state: mode === 'wrong_result' ? 'stopped' : 'active' } });
                            finish(done());
                            return;
                        }
                        if (item.action === 'confirm') {
                            proof();
                            return;
                        }
                        if (item.operation === 'stop' || item.operation === 'uninstall') {
                            committed = true;
                            if (mode === 'committed_cancel') void manager.cancel(1, operationId);
                            emit({ stage: 'result', status: { state: item.operation === 'stop' ? 'stopped' : 'not_installed' } });
                            finish(done());
                            return;
                        }
                        emit({ stage: 'starting_service' });
                        if (mode === 'cancel' || mode === 'hung_cancel')
                            return;
                        if (mode === 'confirmation' || mode === 'duplicate_challenge' || mode === 'stale_challenge') {
                            const challenge = { stage: 'confirmation_required', challenge_id: 'interrupt', policy_digest: policyDigest, service_generation: 'generation', active_connections: 2 };
                            emit(challenge);
                            if (mode === 'duplicate_challenge')
                                emit(challenge);
                            return;
                        }
                        proof();
                        if (mode === 'duplicate_proof')
                            proof();
                        if (mode === 'late_proof') {
                            emit({ stage: 'result', code: 'verification_failed' });
                            finish(done(1));
                        }
                    });
                } });
            queueMicrotask(() => {
                if (accepted)
                    emit({ stage: 'authorized' });
                else if (options.pty) {
                    const marker = /RDV-[a-f0-9-]+/u.exec(command)![0];
                    stdout.write(marker + ' /dev/pts/9\nPass');
                    queueMicrotask(() => stdout.write(mode==='root_multistage'?'code: ':'word: '));
                }
                else {
                    const prompt = /RDV-[a-f0-9-]+:/u.exec(command)![0];
                    stderr.write(prompt.slice(0, 5));
                    queueMicrotask(() => stderr.write(prompt.slice(5)));
                }
            });
            return { stdin, stdout, stderr, result, closed: result.then(() => { }), kill: () => {if(mode!=='hung_cancel')finish(done(1));} };
        },
    } as unknown as DesktopSSHTransportLease;
    const run = (secret = 'ephemeral-admin', operation: DesktopDeploymentOperation = 'ensure', method: DesktopAdministratorMethod = mode === 'root' || mode === 'echo' || mode === 'root_multistage' ? 'root' : 'sudo') => manager.manage(1, { lease, runtimePID: 42, runtimeUID:mode === 'root_runtime' ? 0 : 1000, runtimeGID:mode === 'root_runtime' ? 0 : 1000, runtimeStart:'12345', runtimeSHA256:'a'.repeat(64), loadKit: async () => kit, verifyRuntime: verify }, request(operation, method), event => {
        progress.push(event);
        if (mode === 'cancel' && event.stage === 'starting_service' || mode === 'prepare_cancel' && event.stage === 'preparing_media' && event.received_bytes)
            void manager.cancel(1, operationId);
        if (event.stage === 'authorization_required')
            manager.respond(1, { action: 'respond', operationId, challengeId: event.challenge_id!, administratorPassword: secret });
        if (event.stage === 'confirmation_required' && !['duplicate_challenge','stale_challenge'].includes(mode))
            manager.respond(1, { action: 'respond', operationId, challengeId: event.challenge_id!, confirmed: true });
    });
    return { commands, writes, progress, run, kit, manager, verify, streamOptions, credentialBuffers, settleProof: () => settleProof?.() };
}
describe('SSH desktop deployment transaction', () => {
    it('rejects retired verbs, missing scope and mismatched challenge payloads', () => {
        for (const operation of ['install', 'start', 'update'])
            expect(parseDesktopDeploymentRequest({ ...request(), operation })).toBeUndefined();
        expect(parseDesktopDeploymentRequest({ ...request(), confirmed: false })).toBeUndefined();
        expect(parseDesktopDeploymentRequest({ action: 'respond', operationId, challengeId: 'a', administratorPassword: 'bad\nrequest' })).toBeUndefined();
        expect(parseDesktopDeploymentRequest({ action: 'respond', operationId, challengeId: 'a', confirmed: true, administratorPassword: 'secret' })).toBeUndefined();
    });
    it('uses the fixed command for NOPASSWD and requires actual Runtime verification', async () => {
        const f = fixture();
        expect(await f.run()).toMatchObject({ ok: true, state: 'active', operation_id: operationId });
        expect(f.commands.join(' ')).not.toContain('sudo -n true');
        expect(f.commands.join(' ')).toContain('/usr/lib/redeven-desktop-authorize-');
        expect(f.progress.some(e => e.stage === 'authorization_required')).toBe(false);
        expect(JSON.parse(f.writes[0])).toMatchObject({ version: 2, operation: 'ensure', runtime_uid: 1000, runtime_start: '12345', media_sha256: 'b'.repeat(64) });
        expect(f.verify).toHaveBeenCalledWith(operationId, 'proof', policyDigest, expect.any(AbortSignal));
        expect(JSON.parse(f.writes[1]).action).toBe('commit');
    });
    it('prepares a root Runtime without reading its proc executable as the SSH user', async () => {
        const f = fixture('root_runtime');
        expect(await f.run()).toMatchObject({ ok: true, state: 'active' });
        expect(f.commands.some(command => command.includes('/proc/42'))).toBe(false);
        expect(JSON.parse(f.writes[0])).toMatchObject({ runtime_uid: 0, runtime_gid: 0 });
    });
    it('prepares media before authorization and cleans staging on failure or cancel', async () => {
        for (const mode of ['prepare_failure', 'prepare_cancel'] as const) {
            const f = fixture(mode);
            expect((await f.run()).ok).toBe(false);
            expect(f.commands.some(c => c.includes('sudo'))).toBe(false);
            expect(f.commands.at(-1)).toContain('rm -rf');
        }
        const f = fixture();
        await f.run();
        expect(f.commands.findIndex(c => c.includes('desktop-service-media'))).toBeLessThan(f.commands.findIndex(c => c.includes('sudo')));
    });
    it.each(['stop', 'uninstall'] as const)('does not prepare media for %s', async (operation) => { const f = fixture(); expect((await f.run('', operation)).ok).toBe(true); expect(f.commands.some(c => c.includes('desktop-service-media'))).toBe(false); expect(JSON.parse(f.writes[0])).not.toHaveProperty('media_sha256'); });
    it.each(['password', 'root'] as const)('sends %s credentials once after its challenge and clears mutable buffers', async (mode) => {
        const f = fixture(mode), secret = "special '$ \\ password";
        expect(await f.run(secret)).toMatchObject({ ok: true });
        expect(f.writes[0]).toBe(secret + '\n');
        expect(f.writes.filter(value => value === secret + '\n')).toHaveLength(1);
        expect(JSON.stringify([f.commands, f.progress])).not.toContain(secret);
        expect(f.progress).toContainEqual(expect.objectContaining({ stage: 'authorization_required', host: 'host.example', ssh_user: 'tang', administrator_method: mode === 'root' ? 'root' : 'sudo' }));
        await new Promise(resolve => setImmediate(resolve));
        expect(f.credentialBuffers.every(value => value.every(byte => byte === 0))).toBe(true);
        expect(f.streamOptions.at(-1)).toMatchObject({ pty: mode === 'root', sensitive: true });
    });
    it('withholds root password when echo cannot be verified disabled', async () => { const f = fixture('echo'); expect(await f.run()).toMatchObject({ ok: false, code: 'authentication_challenge_unsupported' }); expect(f.writes).toEqual([]); });
    it('sends a wrong password once without a manager request', async () => { const f = fixture('reject'); expect(await f.run('wrong-secret')).toMatchObject({ ok: false, code: 'authorization_failed' }); expect(f.writes).toEqual(['wrong-secret\n']); });
    it('requires separate transaction-bound interruption confirmation', async () => {
        const f = fixture('confirmation');
        expect((await f.run()).ok).toBe(true);
        expect(f.progress).toContainEqual(expect.objectContaining({ stage: 'confirmation_required', active_connections: 2 }));
        expect(JSON.parse(f.writes[1])).toMatchObject({ action: 'confirm', challenge_id: 'interrupt', policy_digest: policyDigest, operation_id: operationId });
        expect(f.manager.respond(1, { action: 'respond', operationId, challengeId: 'interrupt', confirmed: true }).code).toBe('challenge_expired');
    });
    it('observes rollback on cancellation and failed Runtime admission', async () => { for (const mode of ['cancel', 'proof_failure'] as const) {
        const f = fixture(mode);
        expect(await f.run()).toMatchObject({ ok: false, rollback: 'complete' });
        expect(f.writes.map(value => JSON.parse(value).action)).toContain('cancel');
        expect(f.writes.map(value => JSON.parse(value).action)).not.toContain('commit');
    } });
    it('ignores proof callbacks after manager completion', async () => { const f = fixture('late_proof'); expect((await f.run()).ok).toBe(false); f.settleProof(); await Promise.resolve(); expect(f.writes.map(value => JSON.parse(value).action)).not.toContain('commit'); });
    it.each(['ensure', 'stop', 'uninstall'] as const)('preserves the authoritative committed %s result when cancellation loses the race', async operation => {
        const f = fixture('committed_cancel');
        expect(await f.run('', operation)).toMatchObject({ ok: true, state: operation === 'ensure' ? 'active' : operation === 'stop' ? 'stopped' : 'not_installed' });
        expect(f.writes.map(value => JSON.parse(value).action)).toContain('cancel');
        expect(f.progress.some(value => value.stage === 'rolling_back')).toBe(false);
    });
    it('cancels after peer heartbeat loss and cannot commit a late Runtime proof', async () => {
        vi.useFakeTimers();
        try {
            const f = fixture('heartbeat_loss');
            const running = f.run();
            for (let i = 0; i < 60 && !f.verify.mock.calls.length; i++) await Promise.resolve();
            expect(f.verify).toHaveBeenCalledOnce();
            await vi.advanceTimersByTimeAsync(10_000);
            expect(f.writes.map(value => JSON.parse(value).action).filter(action => action === 'heartbeat')).toHaveLength(2);
            await vi.advanceTimersByTimeAsync(5_000);
            expect(await running).toMatchObject({ ok: false, code: 'transport_interrupted', rollback: 'complete' });
            f.settleProof();
            await Promise.resolve();
            expect(f.writes.map(value => JSON.parse(value).action)).not.toContain('commit');
        } finally { vi.useRealTimers(); }
    });
    it.each(['duplicate_proof', 'wrong_result'] as const)('rejects invalid completion for %s', async (mode) => {
        const f = fixture(mode);
        expect((await f.run()).ok).toBe(false);
        if (mode === 'duplicate_proof') {
            f.settleProof();
            await Promise.resolve();
            expect(f.writes.map(value => JSON.parse(value).action)).not.toContain('commit');
        }
    });
    it('rejects duplicate challenges and releases the pending challenge', async () => { const f = fixture('duplicate_challenge'); expect((await f.run()).ok).toBe(false); expect(f.writes.map(value => JSON.parse(value).action)).toContain('cancel'); });
    it('bounds cancellation even when SSH never settles',async()=>{
        vi.useFakeTimers();try {
            const f=fixture('hung_cancel');const running=f.run();
            for(let i=0;i<50&&!f.progress.some(p=>p.stage==='starting_service');i++)await Promise.resolve();
            let settled=false;void running.then(()=>{settled=true;});
            const cancel=f.manager.cancel(1,operationId);await vi.advanceTimersByTimeAsync(25_000);
            expect(settled).toBe(false);
            await vi.advanceTimersByTimeAsync(15_000);
            expect(await running).toMatchObject({ok:false,rollback:'unknown'});await cancel;
        }finally{vi.useRealTimers();}
    });
    it('rejects another operation and expired challenge without consuming current consent',async()=>{
        const f=fixture('stale_challenge');const running=f.run();
        await vi.waitFor(()=>expect(f.progress.some(p=>p.stage==='confirmation_required')).toBe(true));
        expect(f.manager.respond(1,{action:'respond',operationId:'other',challengeId:'interrupt',confirmed:true}).code).toBe('challenge_expired');
        expect(f.manager.respond(1,{action:'respond',operationId,challengeId:'expired',confirmed:true}).code).toBe('challenge_expired');
        expect(f.manager.respond(1,{action:'respond',operationId,challengeId:'interrupt',confirmed:true}).ok).toBe(true);
        expect((await running).ok).toBe(true);
    });
    it('rejects unsupported root authentication before sending credentials',async()=>{
        const f=fixture('root_multistage');expect(await f.run()).toMatchObject({ok:false,code:'authentication_challenge_unsupported'});expect(f.credentialBuffers).toEqual([]);
    });
    it('rejects changed bytes before transfer and excludes arbitrary progress data', async () => { const f = fixture(); f.kit.files.set('desktop-drm', Buffer.from('modified-worker')); expect(await f.run()).toMatchObject({ ok: false, code: 'deployment_failed' }); expect(f.commands).toHaveLength(1); expect(parseDesktopDeploymentProgress({ operation_id: operationId, stage: 'preparing_media', received_bytes: -1 })).toBeUndefined(); expect(parseDesktopDeploymentProgress({ operation_id: operationId, stage: 'preparing_media', received_bytes: 5, secret: 'omitted' })).toEqual({ operation_id: operationId, stage: 'preparing_media', received_bytes: 5 }); });
    it('preserves permission and asynchronous host cancellation guards', async () => {
        const manager = new RemoteDesktopDeployment();
        expect(await manager.manage(1, async () => { throw new DesktopDeploymentPermissionError(); }, request(), () => { })).toMatchObject({ ok: false, code: 'permission_denied' });
        const preparing = manager.manage(1, signal => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('Canceled preparation')), { once: true }); }), request(), () => { });
        await manager.dispose();
        expect(await preparing).toMatchObject({ ok: false, code: 'canceled' });
    });
});
