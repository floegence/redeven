import { FILE_PREVIEW_FLOWER_QUERY } from '../../../../../../desktop/src/shared/filePreviewWindowRoute';
import { parseFilePreviewWindowRequest } from '../../../../../../desktop/src/shared/filePreviewWindow';
import { buildFilePreviewFlowerTurnLauncherIntent } from '../utils/filePreviewAskFlower';

export function filePreviewFlowerIntent(path: string) {
  if (!parseFilePreviewWindowRequest({ path })) return null;
  return buildFilePreviewFlowerTurnLauncherIntent({ item: {
    type: 'file', id: path, path, name: path.slice(path.lastIndexOf('/') + 1),
  } }).intent;
}

export function consumeFilePreviewFlowerIntent() {
  const url = new URL(window.location.href);
  const paths = url.searchParams.getAll(FILE_PREVIEW_FLOWER_QUERY);
  url.searchParams.delete(FILE_PREVIEW_FLOWER_QUERY);
  window.history.replaceState(window.history.state, '', url);
  return paths.length === 1 ? filePreviewFlowerIntent(paths[0]) : null;
}

export function receiveFilePreviewFlowerIntent(path: string | undefined, invalid: string) {
  const intent = path ? filePreviewFlowerIntent(path) : consumeFilePreviewFlowerIntent();
  if (!intent) throw new Error(invalid);
  return intent;
}
