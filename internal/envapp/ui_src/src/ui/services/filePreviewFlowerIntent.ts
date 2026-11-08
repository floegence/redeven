import { parseFilePreviewWindowRequest } from '../../../../../../desktop/src/shared/filePreviewWindow';
import { buildFilePreviewFlowerTurnLauncherIntent } from '../utils/filePreviewAskFlower';

export function filePreviewFlowerIntent(path: string) {
  if (!parseFilePreviewWindowRequest({ path })) return null;
  return buildFilePreviewFlowerTurnLauncherIntent({ item: {
    type: 'file', id: path, path, name: path.slice(path.lastIndexOf('/') + 1),
  } }).intent;
}
