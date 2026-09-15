import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { forwardQualificationResponse } from './qualification_response_stream.mjs';

async function fixture(t, body) {
  let finish;
  const forwarded = new Promise((resolve) => { finish = resolve; });
  const server = http.createServer(async (_request, response) => {
    try { finish({ result: await forwardQualificationResponse(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }), response) }); }
    catch (error) { finish({ error }); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return { url: `http://127.0.0.1:${server.address().port}`, forwarded };
}

test('forwards a complete response without changing its bytes', async (t) => {
  const wire = 'data: {"type":"response.completed"}\n\n';
  const { url, forwarded } = await fixture(t, wire);
  const response = await fetch(url);
  assert.equal(await response.text(), wire);
  assert.deepEqual(await forwarded, { result: 'complete' });
});

test('midstream upstream failure is caught, sanitized and reaches the client', async (t) => {
  let fail;
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('data: {"type":"response.created"}\n\n'));
    fail = () => controller.error(new Error('Authorization: secret-provider-detail'));
  } });
  const { url, forwarded } = await fixture(t, body);
  const response = await fetch(url);
  const reader = response.body.getReader();
  assert.equal((await reader.read()).done, false);
  fail();
  await assert.rejects(reader.read());
  const { error } = await forwarded;
  assert.equal(error.message, 'Qualification upstream response interrupted');
  assert.equal(String(error).includes('secret-provider-detail'), false);
});

test('client cancellation drains the upstream without reporting provider failure', async (t) => {
  let canceled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: pending\n\n')); },
    cancel() { canceled = true; },
  });
  const { url, forwarded } = await fixture(t, body);
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  const reader = response.body.getReader();
  await reader.read();
  controller.abort();
  await assert.rejects(reader.read());
  assert.deepEqual(await forwarded, { result: 'canceled' });
  assert.equal(canceled, true);
});
