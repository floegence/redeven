/// <reference lib="webworker" />

import type { DiffWorkerRequest, DiffWorkerResponse } from '../types';
import { computeCodeDiffModel, EMPTY_CODE_DIFF_RENDER_MODEL } from '../diff/diffModel';

postMessage({ type: 'ready' });

addEventListener('message', (event: MessageEvent<DiffWorkerRequest>) => {
  const { id, oldCode, newCode } = event.data;

  try {
    postMessage({
      id,
      model: computeCodeDiffModel(oldCode, newCode),
    } satisfies DiffWorkerResponse);
  } catch (error) {
    postMessage({
      id,
      model: EMPTY_CODE_DIFF_RENDER_MODEL,
      error: error instanceof Error ? error.message : 'Failed to compute diff',
    } satisfies DiffWorkerResponse);
  }
});
