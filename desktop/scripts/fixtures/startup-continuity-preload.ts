import { bootstrapDesktopResourceCacheBridge } from '../../src/preload/desktopResourceCache';
import { bootstrapDesktopStateStorageBridge } from '../../src/preload/desktopStateStorage';
import { bootstrapDesktopSessionContextBridge } from '../../src/preload/desktopSessionContext';
bootstrapDesktopResourceCacheBridge();
bootstrapDesktopStateStorageBridge();
bootstrapDesktopSessionContextBridge();
