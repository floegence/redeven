import '../index.css';
import './flower-feature.css';
import { it } from 'vitest';
import { page } from 'vitest/browser';
import { assertWebSearchSurface } from './FlowerSurface.webSearch.scenario';
it('renders the weather search history in the complete Flower surface', async () => {
 await page.viewport(1200, 900);
 const runtime = await assertWebSearchSurface();
 runtime.style.height = '780px';
 await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
 if (import.meta.env.VITE_WEB_SEARCH_SCREENSHOT === '1') await page.screenshot();
});
