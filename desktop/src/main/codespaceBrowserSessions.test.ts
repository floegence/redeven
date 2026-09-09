import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { expect, it, vi } from 'vitest';
import { CodeSpaceBrowserSessions } from './codespaceBrowserSessions';
import { NativeCodeSpaceProfiles } from './codespaceNativeProfiles';
import type { NativeCodeSpaceRoute } from './codespaceNativeGateway';

function route(): NativeCodeSpaceRoute {
  return {
    pathPrefix: '',
    authority: '',
    headers: {},
    openConnection: async () => {
      throw new Error('unused');
    },
    close: vi.fn(async () => {}),
  };
}
function probe(url: string): Promise<number> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: '127.0.0.1',
        port: target.port,
        headers: { Host: target.host },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode!);
      },
    );
    req.on('error', reject);
  });
}

it('owns browser routes independently, reacquires on reopen and closes them with the environment', async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'codespace-browser-session-'),
  );
  const sessions = new CodeSpaceBrowserSessions();
  const routes: NativeCodeSpaceRoute[] = [];
  const urls: string[] = [];
  const options = {
    identity: 'a'.repeat(64),
    profiles: new NativeCodeSpaceProfiles(path.join(root, 'profiles.json')),
    createRoute: vi.fn(async () => {
      const value = route();
      routes.push(value);
      return value;
    }),
    openExternal: vi.fn(async (url: string) => {
      urls.push(url);
    }),
  };
  try {
    await sessions.open('one', options);
    expect(await probe(urls[0]!)).toBe(401);
    await sessions.open('one', options);
    expect(routes[0]!.close).toHaveBeenCalledOnce();
    expect(new URL(urls[0]!).origin).toBe(new URL(urls[1]!).origin);
    expect(urls[0]).not.toBe(urls[1]);
    await sessions.open('two', { ...options, identity: 'b'.repeat(64) });
    expect(new URL(urls[2]!).hostname).not.toBe(new URL(urls[1]!).hostname);
    expect(routes[1]!.close).not.toHaveBeenCalled();
    await sessions.close();
    for (const value of routes) expect(value.close).toHaveBeenCalledOnce();
    for (const url of urls)
      await expect(probe(url)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    await expect(sessions.open('one', options)).rejects.toThrow(
      'codespace_closed',
    );
  } finally {
    await sessions.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it('does not open a browser after environment close races route acquisition', async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'codespace-browser-race-'),
  );
  const sessions = new CodeSpaceBrowserSessions();
  let resolve!: (route: NativeCodeSpaceRoute) => void;
  const ready = new Promise<NativeCodeSpaceRoute>((done) => {
    resolve = done;
  });
  const openExternal = vi.fn(async () => {});
  const value = route();
  const opening = sessions.open('one', {
    identity: 'a'.repeat(64),
    profiles: new NativeCodeSpaceProfiles(path.join(root, 'profiles.json')),
    createRoute: () => ready,
    openExternal,
  });
  const failed = expect(opening).rejects.toThrow('codespace_closed');
  await Promise.resolve();
  const closing = sessions.close();
  resolve(value);
  try {
    await failed;
    await closing;
    expect(value.close).toHaveBeenCalledOnce();
    expect(openExternal).not.toHaveBeenCalled();
  } finally {
    await sessions.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it('closes the owned route if the OS rejects browser opening', async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'codespace-browser-open-failure-'),
  );
  const sessions = new CodeSpaceBrowserSessions();
  const value = route();
  let entry = '';
  try {
    await expect(
      sessions.open('one', {
        identity: 'a'.repeat(64),
        profiles: new NativeCodeSpaceProfiles(path.join(root, 'profiles.json')),
        createRoute: async () => value,
        openExternal: async (url) => {
          entry = url;
          throw new Error('OS rejected');
        },
      }),
    ).rejects.toThrow('OS rejected');
    expect(value.close).toHaveBeenCalledOnce();
    await expect(probe(entry)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  } finally {
    await sessions.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it('coalesces concurrent opens into one route and one OS action', async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'codespace-browser-concurrent-'),
  );
  const sessions = new CodeSpaceBrowserSessions();
  let resolve!: (value: NativeCodeSpaceRoute) => void;
  const ready = new Promise<NativeCodeSpaceRoute>((done) => {
    resolve = done;
  });
  const options = {
    identity: 'a'.repeat(64),
    profiles: new NativeCodeSpaceProfiles(path.join(root, 'profiles.json')),
    createRoute: vi.fn(() => ready),
    openExternal: vi.fn(async () => {}),
  };
  try {
    const first = sessions.open('one', options);
    const second = sessions.open('one', options);
    await Promise.resolve();
    resolve(route());
    await Promise.all([first, second]);
    expect(options.createRoute).toHaveBeenCalledOnce();
    expect(options.openExternal).toHaveBeenCalledOnce();
  } finally {
    await sessions.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
