import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// A qualification proxy must propagate stream failure to the real provider
// client without crashing the harness or logging the raw transport exception.
export async function forwardQualificationResponse(upstream, response) {
  response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' });
  if (!upstream.body) { response.end(); return 'complete'; }
  const source = Readable.fromWeb(upstream.body);
  let upstreamFailed = false;
  let downstreamCanceled = false;
  source.once('error', () => { if (!downstreamCanceled) upstreamFailed = true; });
  const closed = () => { if (!upstreamFailed && !response.writableFinished) downstreamCanceled = true; };
  response.once('close', closed);
  try {
    await pipeline(source, response);
    return 'complete';
  } catch {
    if (downstreamCanceled) return 'canceled';
    throw new Error('Qualification upstream response interrupted');
  } finally { response.off('close', closed); }
}
