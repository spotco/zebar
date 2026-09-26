/**
 * Pure helpers for GlazeWM IPC port validation and reconnect decisions.
 * Kept free of Tauri / WmClient imports so unit tests can run in Node.
 */

export const DEFAULT_GLAZEWM_IPC_PORT = 6123;

/**
 * Bounded rediscovery delays after disconnect (ms).
 * Immediate check, then retries every 0.5–2s for several attempts.
 */
export const GLAZEWM_REDISCOVERY_DELAYS_MS: readonly number[] = [
  0, 500, 1000, 1500, 2000, 2000, 2000,
];

export function isValidGlazeWmIpcPort(port: unknown): port is number {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** Normalize a discovered port; invalid/missing values fall back to 6123. */
export function normalizeGlazeWmIpcPort(port: unknown): number {
  return isValidGlazeWmIpcPort(port) ? port : DEFAULT_GLAZEWM_IPC_PORT;
}

/**
 * Parse ipc.port file contents (trimmed decimal integer in 1..=65535).
 * Returns null when empty / nonnumeric / out of range.
 */
export function parseGlazeWmIpcPortContents(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  // Reject non-decimal forms — match Rust parse::<u32>().
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const port = Number(trimmed);
  return isValidGlazeWmIpcPort(port) ? port : null;
}

export type GlazeWmReconnectAction = 'keep' | 'replace';

/**
 * Decide whether the existing WmClient can keep reconnecting, or must be
 * replaced because GlazeWM bound a different IPC port.
 */
export function decideGlazeWmReconnectAction(
  currentPort: number,
  discoveredPort: number,
): GlazeWmReconnectAction {
  return currentPort === discoveredPort ? 'keep' : 'replace';
}
