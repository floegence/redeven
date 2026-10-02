import { connect, createArtifactLease, parseArtifact, type JsonValue } from '@floegence/flowersec-core/browser';

// Runs inside the real Runtime origin. All browser requests use its isolated
// Gateway proxy partition and ordinary Runtime login cookies.
export async function verifyRuntimeServices(): Promise<string[]> {
  const response = await fetch('/api/local/direct/connect_artifact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (!response.ok) throw new Error(`Runtime artifact rejected: ${response.status}`);
  const envelope = await response.json();
  const acquisition = envelope.data ?? envelope;
  let stage = 'before spend';
  const lease = createArtifactLease(parseArtifact(acquisition.connect_artifact), async signal => {
    stage = 'spending';
    const { v: _version, ...scope } = acquisition.spend_scope;
    const attemptID = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const spent = await fetch('/api/local/direct/artifact/spend', { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...scope, attempt_id: attemptID }) });
    stage = `spend status ${spent.status}`;
    if (!spent.ok) throw new Error(`Runtime artifact spend rejected: ${spent.status}`);
  });
  const current = await connect(lease, { connectTimeoutMs: 10_000 }).catch(error => { throw new Error(`${String(error)} (${stage})`); });
  const rpc = async (id: number, payload: JsonValue) => {
    const result = await current.rpc.call(id, payload, value => value, { signal: AbortSignal.timeout(10_000) });
    if (!result.ok) throw new Error(`Runtime RPC ${id} failed: ${result.error.code}`);
    return result.payload as Record<string, JsonValue>;
  };
  try {
    await current.probeLiveness({ signal: AbortSignal.timeout(5000) });
    const files = await rpc(1001, { path: '' });
    if (!Array.isArray(files.entries)) throw new Error('Runtime file listing missing');
    const terminal = await rpc(2001, { name: 'Gateway qualification' });
    if (!(terminal.session as Record<string, JsonValue>)?.id) throw new Error('Runtime terminal creation failed');
    const sessions = await rpc(2002, {});
    if (!Array.isArray(sessions.sessions)) throw new Error('Runtime terminal listing missing');
    const headers = { 'X-Redeven-Plugin-Session': acquisition.plugin_session_credential };
    const threads = await fetch('/_redeven_proxy/api/ai/threads', { headers });
    if (!threads.ok) throw new Error(`Flower thread list failed: ${threads.status}`);
    const abort = new AbortController();
    const stream = await fetch('/_redeven_proxy/api/ai/flower/stream', { headers, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]) });
    if (!stream.ok || !stream.headers.get('content-type')?.includes('text/event-stream')) throw new Error(`Flower stream failed: ${stream.status}`);
    const reader = stream.body!.getReader();
    const first = await reader.read();
    abort.abort();
    if (!first.value?.length) throw new Error('Flower stream did not flush');
    return ['production Flowersec WSS handshake and liveness', 'Runtime file listing and terminal creation over Gateway', 'Flower thread list and workspace event stream over Gateway'];
  } finally { await current.close(); }
}
