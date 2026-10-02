import * as zebar from './zebar-local.js'; // local ipc.port-aware client (skip CDN 6123-only)

/**
 * Zebar provider group configuration
 * Provides data for GlazeWM workspaces, system stats, media, and network
 */
export const providers = zebar.createProviderGroup({
  glazewm: { type: 'glazewm' },
  date: { type: 'date', formatting: 'yyyy-MM-dd EEE HH:mm' },
  cpu: { type: 'cpu' },
  memory: { type: 'memory' },
  battery: { type: 'battery' },
  network: { type: 'network' },
  media: { type: 'media' },
});
