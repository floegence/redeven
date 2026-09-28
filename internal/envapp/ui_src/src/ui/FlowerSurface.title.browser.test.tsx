import { beforeEach } from 'vitest';
import { page } from 'vitest/browser';

import '../index.css';
import './flower-feature.css';
import './FlowerSurface.title.test.shared';

// These scenarios keep navigation and the conversation visible together.
beforeEach(() => page.viewport(1280, 900));
