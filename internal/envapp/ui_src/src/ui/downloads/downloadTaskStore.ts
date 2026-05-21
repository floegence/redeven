import { createSignal } from 'solid-js';

import type { DownloadTask, DownloadTaskStatus, DownloadTaskStore } from './types';

const ACTIVE_STATUSES = new Set<DownloadTaskStatus>([
  'queued',
  'choosing_destination',
  'streaming',
  'finalizing',
]);

export function createDownloadTaskStore(): DownloadTaskStore {
  const [tasks, setTasks] = createSignal<readonly DownloadTask[]>([]);

  return {
    tasks,
    activeCount: () => tasks().filter((task) => ACTIVE_STATUSES.has(task.status)).length,
    latestTask: () => tasks()[0] ?? null,
    getTask(id) {
      return tasks().find((task) => task.id === id);
    },
    addTask(task) {
      setTasks((current) => [task, ...current]);
    },
    patchTask(id, patch) {
      setTasks((current) => current.map((task) => (
        task.id === id
          ? { ...task, ...patch }
          : task
      )));
    },
    clearFinished() {
      setTasks((current) => current.filter((task) => ACTIVE_STATUSES.has(task.status)));
    },
  };
}
