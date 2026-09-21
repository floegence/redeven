import { expect, it } from 'vitest';
import { parseBrowserPackageRequest, parseBrowserPackageProgress } from './browserPackageIPC';
it('admits fixed package identity and refuses renderer-selected URLs and paths', () => {
  const request = { action: 'acquire', operation_id: 'op-1', package: { id: 'chromium-linux-arm64', sha256: 'a'.repeat(64), size_bytes: 194706293 } };
  expect(parseBrowserPackageRequest(request)).toEqual(request);
  expect(parseBrowserPackageRequest({ ...request, url: 'https://example.test/file' })).toBeUndefined();
  expect(parseBrowserPackageRequest({ ...request, package: { ...request.package, path: '/private/file' } })).toBeUndefined();
  expect(parseBrowserPackageRequest({ action: 'read', operation_id: 'op-1', offset: -1 })).toBeUndefined();
  expect(parseBrowserPackageRequest({ action: 'read', operation_id: 'op-1', offset: 1.5 })).toBeUndefined();
  expect(parseBrowserPackageRequest({ ...request, package: { ...request.package, sha256: '../outside' } })).toBeUndefined();
  expect(parseBrowserPackageProgress({ operation_id: 'op', phase: 'downloading', received_bytes: 10, total_bytes: 8 })).toBeUndefined();
});
