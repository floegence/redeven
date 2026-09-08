// @vitest-environment jsdom
import { it } from 'vitest';
import { assertWebSearchSurface } from './FlowerSurface.webSearch.scenario';
it('shows canonical web activity without empty disclosures and opens sources', assertWebSearchSurface);
