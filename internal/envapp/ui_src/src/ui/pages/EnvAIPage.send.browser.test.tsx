import { beforeEach } from 'vitest';
import { page } from 'vitest/browser';

import { registerEnvAIPageSendTests } from './EnvAIPage.send.test.shared';

registerEnvAIPageSendTests();

// This integration suite exercises desktop history and chat side by side.
beforeEach(() => page.viewport(1280, 900));
