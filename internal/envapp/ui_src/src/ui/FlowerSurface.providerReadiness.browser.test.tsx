import { beforeEach } from 'vitest';
import { page } from 'vitest/browser';
import '../index.css';
import './flower-feature.css';
import './FlowerSurface.providerReadiness.test.shared';

beforeEach(() => page.viewport(1280, 900));
