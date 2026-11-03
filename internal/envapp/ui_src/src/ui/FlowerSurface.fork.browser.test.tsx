import { beforeEach } from 'vitest';
import { page } from 'vitest/browser';

import '../index.css';
import './flower-feature.css';
import './FlowerSurface.fork.test.shared';

// These scenarios keep navigation and the conversation visible together.
beforeEach(async () => {
  await page.viewport(1280, 900);
  // Deliver the viewport resize before opening menus that dismiss on resize.
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
});
