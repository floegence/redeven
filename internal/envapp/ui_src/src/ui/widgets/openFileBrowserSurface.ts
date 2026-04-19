import type { FileBrowserSurfaceController, FileBrowserSurfaceOpenParams } from './createFileBrowserSurfaceController';
import { normalizeAbsolutePath } from '../utils/askFlowerPath';

export async function openFileBrowserSurface(params: Readonly<{
  input: FileBrowserSurfaceOpenParams;
  controller: FileBrowserSurfaceController;
}>): Promise<boolean> {
  const path = normalizeAbsolutePath(params.input.path);
  if (!path) return false;

  const homePath = normalizeAbsolutePath(params.input.homePath ?? '');
  const normalizedInput: FileBrowserSurfaceOpenParams = {
    ...params.input,
    path,
    homePath: homePath || undefined,
  };
  return params.controller.openSurface(normalizedInput) !== null;
}
