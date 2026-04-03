import { createSignal, untrack, type Accessor } from 'solid-js';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import type { PickerEnsurePath } from '@floegence/floe-webapp-core/ui';
import { normalizeAbsolutePath } from './askFlowerPath';
import {
  hasPickerFolderPath,
  listPickerTreePathChain,
  normalizePickerTreePath,
  replacePickerChildren,
  sortPickerFolderItems,
  toPickerFolderItem,
  toPickerTreeAbsolutePath,
} from './directoryPickerTree';

type DirectoryEntryLike = {
  name?: string | null;
  path?: string | null;
  isDirectory?: boolean | null;
  size?: number | null;
  modifiedAt?: number | null;
};

export type DirectoryPickerListDirectory<Entry extends DirectoryEntryLike = DirectoryEntryLike> = (
  absolutePath: string,
) => Promise<readonly Entry[] | Entry[]>;

export type DirectoryPickerDataSource = ReturnType<typeof createDirectoryPickerDataSource>;

export function createDirectoryPickerDataSource<Entry extends DirectoryEntryLike>(args: {
  homePath: Accessor<string | undefined>;
  listDirectory: DirectoryPickerListDirectory<Entry>;
}) {
  const [files, setFiles] = createSignal<FileItem[]>([]);
  let cache = new Map<string, FileItem[]>();
  let inflight = new Map<string, Promise<FileItem[]>>();
  let revision = 0;

  const readHomePath = (): string => normalizeAbsolutePath(untrack(args.homePath) ?? '');

  const reset = () => {
    revision += 1;
    cache = new Map();
    inflight = new Map();
    setFiles([]);
  };

  const loadDirectory = async (pickerPath: string): Promise<FileItem[]> => {
    const normalizedPickerPath = normalizePickerTreePath(pickerPath);
    const homePath = readHomePath();
    const absolutePath = toPickerTreeAbsolutePath(normalizedPickerPath, homePath);
    if (!absolutePath) {
      return [];
    }

    const cached = cache.get(absolutePath);
    if (cached) {
      setFiles((prev) => replacePickerChildren(prev, normalizedPickerPath, cached));
      return cached;
    }

    const running = inflight.get(absolutePath);
    if (running) {
      return running;
    }

    const requestRevision = revision;
    const request = Promise.resolve(args.listDirectory(absolutePath))
      .then((entries) => sortPickerFolderItems(
        Array.from(entries ?? [])
          .map((entry) => toPickerFolderItem(entry, homePath))
          .filter((item): item is FileItem => Boolean(item)),
      ))
      .then((items) => {
        if (requestRevision !== revision) {
          return items;
        }
        cache.set(absolutePath, items);
        setFiles((prev) => replacePickerChildren(prev, normalizedPickerPath, items));
        return items;
      })
      .finally(() => {
        if (inflight.get(absolutePath) === request) {
          inflight.delete(absolutePath);
        }
      });

    inflight.set(absolutePath, request);
    return request;
  };

  const ensurePath: PickerEnsurePath = async (path) => {
    const targetPath = normalizePickerTreePath(path);
    if (targetPath === '/') {
      return { status: 'ready', resolvedPath: '/' };
    }
    if (hasPickerFolderPath(files(), targetPath)) {
      return { status: 'ready', resolvedPath: targetPath };
    }

    try {
      const chain = listPickerTreePathChain(targetPath);
      for (let index = 0; index < chain.length - 1; index += 1) {
        const parentPath = chain[index] ?? '/';
        const nextPath = chain[index + 1] ?? targetPath;
        const children = await loadDirectory(parentPath);
        const nextExists = children.some((item) => (
          item.type === 'folder'
          && normalizePickerTreePath(item.path) === nextPath
        ));
        if (!nextExists) {
          return {
            status: 'missing',
            resolvedPath: targetPath,
            message: 'Path not found',
          };
        }
      }

      return hasPickerFolderPath(files(), targetPath)
        ? { status: 'ready', resolvedPath: targetPath }
        : { status: 'missing', resolvedPath: targetPath, message: 'Path not found' };
    } catch {
      return {
        status: 'error',
        resolvedPath: targetPath,
        message: 'Could not load path',
      };
    }
  };

  return {
    files,
    reset,
    ensureRootLoaded: () => loadDirectory('/'),
    expandPath: async (pickerPath: string) => {
      await loadDirectory(pickerPath);
    },
    ensurePath,
  };
}
