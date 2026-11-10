import { expect, it } from 'vitest';
import { formatStorageBytes, orderStorageEntries, storageDestination, type StorageEntry } from './storageOverview';
const entry = (id: string, bytes = 0): StorageEntry => ({ id, path: '/environment/task-files', bytes, present: true, complete: true, kind: 'persistent', backup: 'environment' });
it('routes only declared owners and preserves plugin independence and opaque stores', () => {
  expect(storageDestination(entry('plugins'))).toEqual({ kind: 'plugins' });
  expect(storageDestination(entry('snapshots'))).toBeUndefined();
  expect(storageDestination(entry('task_files'))).toEqual({ kind: 'files', path: '/environment/task-files' });
  for (const id of ['cache', 'runtime', 'audit', 'diagnostics', 'unknown']) expect(storageDestination(entry(id))).toBeUndefined();
});
it('orders without mutating the server response and uses appropriate size units', () => {
  const source = [entry('skills', 600), entry('flower', 2_500_000_000)];
  expect(orderStorageEntries(source).map(item => item.id)).toEqual(['flower', 'skills']);
  expect(source[0].id).toBe('skills');
  expect(formatStorageBytes(600, 'en-US')).toBe('600 byte');
  expect(formatStorageBytes(2_500_000_000, 'en-US')).toBe('2.5 GB');
});
