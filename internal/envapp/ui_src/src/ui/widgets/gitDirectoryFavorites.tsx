import { Show, createSignal, untrack } from 'solid-js';
import { Star } from '@floegence/floe-webapp-core/icons';
import { directoryFavoriteAction } from '../../../../../flower_ui/src/filePicker/directoryFavorites';
import { useEnvDirectoryFavorites } from '../services/directoryFavorites';
import type { GitContextMenuActionItem } from './GitEntityContextMenu';

/** Capture the live filesystem directory and authenticated client with each menu. */
export function useGitDirectoryFavorites() {
  const favorites = useEnvDirectoryFavorites();
  const [error, setError] = createSignal('');
  const actions = new WeakMap<object, ReturnType<typeof directoryFavoriteAction>>();
  return {
    item(path: string, target: object): GitContextMenuActionItem | undefined {
      if (!actions.has(target)) actions.set(target, untrack(() => directoryFavoriteAction(path, favorites.directoryFavorites, favorites.copy,
        failure => setError(failure instanceof Error ? failure.message : favorites.copy.favoritesLoadFailed))));
      const action = actions.get(target);
      return action ? {id:'directory-favorite',kind:'action',group:'navigate',rank:30,
        label:action.label,icon:Star,get disabled() {return action.disabled;},onSelect:() => {setError('');action.run();}} : undefined;
    },
    Feedback: () => <Show when={error()}><p role="alert" class="px-2 text-xs text-error">{error()}</p></Show>,
  };
}
