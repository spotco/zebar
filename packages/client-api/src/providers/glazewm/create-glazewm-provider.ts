import {
  WmClient,
  WmEventType,
  type RunCommandResponse,
  type UnlistenFn,
  type WmEvent,
} from 'glazewm';
import { z } from 'zod';

import { getMonitors, readGlazeWmIpcPort } from '~/desktop';
import { getCoordinateDistance } from '~/utils';
import { createBaseProvider } from '../create-base-provider';
import type {
  GlazeWmProvider,
  GlazeWmProviderConfig,
} from './glazewm-provider-types';
import {
  DEFAULT_GLAZEWM_IPC_PORT,
  GLAZEWM_REDISCOVERY_DELAYS_MS,
  decideGlazeWmReconnectAction,
  normalizeGlazeWmIpcPort,
} from './glazewm-ipc';

const glazeWmProviderConfigSchema = z.object({
  type: z.literal('glazewm'),
});

async function resolveGlazeWmIpcPort(): Promise<number> {
  // Single source of truth: GlazeWM writes ~/.glzr/glazewm/ipc.port on bind.
  // Read via Tauri (Rust fs) — no cmd.exe, no multi-port probe.
  try {
    return normalizeGlazeWmIpcPort(await readGlazeWmIpcPort());
  } catch {
    // Command missing / invoke failed: fall through to default.
    return DEFAULT_GLAZEWM_IPC_PORT;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function createGlazeWmProvider(
  config: GlazeWmProviderConfig,
): GlazeWmProvider {
  const mergedConfig = glazeWmProviderConfigSchema.parse(config);

  return createBaseProvider(mergedConfig, async queue => {
    const monitors = await getMonitors();

    let disposed = false;
    /** Bumped on every client replacement / dispose so stale callbacks no-op. */
    let generation = 0;
    /** Generation currently running rediscovery, or null if idle. */
    let recoveringGen: number | null = null;
    let rediscoveryEpoch = 0;
    let client: WmClient | null = null;
    let currentPort = DEFAULT_GLAZEWM_IPC_PORT;
    let unlistenEvents: null | UnlistenFn = null;

    function isActive(gen: number): boolean {
      return !disposed && gen === generation;
    }

    async function clearSubscription(): Promise<void> {
      const unlisten = unlistenEvents;
      unlistenEvents = null;
      if (!unlisten) {
        return;
      }
      try {
        await unlisten();
      } catch {
        // Best-effort cleanup while tearing down a stale client.
      }
    }

    async function disposeClient(target: WmClient | null): Promise<void> {
      await clearSubscription();
      if (!target) {
        return;
      }
      try {
        await target.closeConnection();
      } catch {
        // closeConnection may reject if the socket never opened.
      }
    }

    function attachClient(port: number, gen: number): WmClient {
      console.info(`[glazewm-ipc] connect port=${port}`);
      const next = new WmClient({ port });
      client = next;
      currentPort = port;

      next.onDisconnect(() => {
        if (!isActive(gen)) {
          return;
        }
        console.info(`[glazewm-ipc] disconnected port=${port}`);
        queue.error('Failed to connect to GlazeWM IPC server.');
        void handleDisconnect(gen);
      });

      next.onConnect(async () => {
        if (!isActive(gen) || client !== next) {
          return;
        }

        // Successful (re)connect cancels in-flight rediscovery for this gen.
        rediscoveryEpoch += 1;

        let state = await getInitialState();
        if (!isActive(gen) || client !== next) {
          return;
        }
        queue.output(state);

        unlistenEvents ??= await next.subscribe(WmEventType.ALL, onEvent);

        async function onEvent(e: WmEvent) {
          if (!isActive(gen) || client !== next) {
            return;
          }

          switch (e.eventType) {
            case WmEventType.BINDING_MODES_CHANGED: {
              state = { ...state, bindingModes: e.newBindingModes };
              break;
            }
            case WmEventType.FOCUS_CHANGED: {
              state = { ...state, focusedContainer: e.focusedContainer };
              state = { ...state, ...(await getMonitorState()) };
              if (!isActive(gen) || client !== next) {
                return;
              }

              const tiling = await next.queryTilingDirection();
              if (!isActive(gen) || client !== next) {
                return;
              }
              const globalTilingDirection =
                (tiling as { globalTilingDirection?: typeof tiling.tilingDirection })
                  .globalTilingDirection ?? tiling.tilingDirection;
              state = {
                ...state,
                tilingDirection: globalTilingDirection,
                globalTilingDirection,
              };
              break;
            }
            case WmEventType.FOCUSED_CONTAINER_MOVED: {
              state = { ...state, focusedContainer: e.focusedContainer };
              state = { ...state, ...(await getMonitorState()) };
              break;
            }
            case WmEventType.TILING_DIRECTION_CHANGED: {
              // Keep the legacy focused-container field separate. The
              // WM-wide value is updated by GlobalTilingDirectionChanged.
              state = {
                ...state,
                tilingDirection: e.newTilingDirection,
              };
              break;
            }
            default: {
              // Spotcobuild: global_tiling_direction_changed (not yet in glazewm-js enum).
              const raw = e as { eventType?: string; newTilingDirection?: typeof state.tilingDirection };
              if (
                raw.eventType === 'global_tiling_direction_changed' &&
                raw.newTilingDirection
              ) {
                state = {
                  ...state,
                  tilingDirection: raw.newTilingDirection,
                  globalTilingDirection: raw.newTilingDirection,
                };
              }
              break;
            }
            case WmEventType.WORKSPACE_ACTIVATED:
            case WmEventType.WORKSPACE_DEACTIVATED:
            case WmEventType.WORKSPACE_UPDATED: {
              state = { ...state, ...(await getMonitorState()) };
              break;
            }
            case WmEventType.PAUSE_CHANGED: {
              state = { ...state, isPaused: e.isPaused };
              break;
            }
          }

          if (!isActive(gen) || client !== next) {
            return;
          }
          queue.output(state);
        }

        function runCommand(
          command: string,
          subjectContainerId?: string,
        ): Promise<RunCommandResponse> {
          return next.runCommand(command, subjectContainerId);
        }

        async function getInitialState() {
          const { focused: focusedContainer } = await next.queryFocused();
          const { bindingModes } = await next.queryBindingModes();
          const tiling = await next.queryTilingDirection();
          const globalTilingDirection =
            (tiling as { globalTilingDirection?: typeof tiling.tilingDirection })
              .globalTilingDirection ?? tiling.tilingDirection;
          const isPaused = await getIsPaused();

          return {
            ...(await getMonitorState()),
            focusedContainer,
            tilingDirection: globalTilingDirection,
            globalTilingDirection,
            bindingModes,
            isPaused,
            runCommand,
          };
        }

        // Paused state is only available on v3.7.0+ of GlazeWM.
        async function getIsPaused() {
          try {
            const { paused } = await next.queryPaused();
            return paused;
          } catch {
            return false;
          }
        }

        async function getMonitorState() {
          const currentPosition = {
            x: monitors.currentMonitor!.x,
            y: monitors.currentMonitor!.y,
          };

          const { monitors: glazeWmMonitors } = await next.queryMonitors();
          const { windows: glazeWmWindows } = await next.queryWindows();

          // Get GlazeWM monitor that corresponds to the widget's monitor.
          const currentGlazeWmMonitor = glazeWmMonitors.reduce((a, b) =>
            getCoordinateDistance(currentPosition, a) <
            getCoordinateDistance(currentPosition, b)
              ? a
              : b,
          );

          const focusedGlazeWmMonitor = glazeWmMonitors.find(
            monitor => monitor.hasFocus,
          );

          const allGlazeWmWorkspaces = glazeWmMonitors.flatMap(
            monitor => monitor.children,
          );

          const focusedGlazeWmWorkspace =
            focusedGlazeWmMonitor?.children.find(
              workspace => workspace.hasFocus,
            );

          const displayedGlazeWmWorkspace =
            currentGlazeWmMonitor.children.find(
              workspace => workspace.isDisplayed,
            );

          return {
            displayedWorkspace: displayedGlazeWmWorkspace!,
            focusedWorkspace: focusedGlazeWmWorkspace!,
            currentWorkspaces: currentGlazeWmMonitor.children,
            allWorkspaces: allGlazeWmWorkspaces,
            focusedMonitor: focusedGlazeWmMonitor!,
            currentMonitor: currentGlazeWmMonitor,
            allMonitors: glazeWmMonitors,
            allWindows: glazeWmWindows,
          };
        }
      });

      return next;
    }

    async function replaceClient(port: number): Promise<void> {
      const previous = client;
      // Invalidate old callbacks before closing so reconnect/event races
      // cannot update provider state after replacement.
      generation += 1;
      const gen = generation;
      client = null;
      await disposeClient(previous);
      if (disposed) {
        return;
      }
      attachClient(port, gen);
    }

    async function handleDisconnect(gen: number): Promise<void> {
      if (!isActive(gen) || recoveringGen !== null) {
        return;
      }

      recoveringGen = gen;
      const epoch = ++rediscoveryEpoch;
      let loggedKeep = false;

      try {
        for (const delayMs of GLAZEWM_REDISCOVERY_DELAYS_MS) {
          if (!isActive(gen) || epoch !== rediscoveryEpoch) {
            return;
          }
          if (delayMs > 0) {
            await sleep(delayMs);
          }
          if (!isActive(gen) || epoch !== rediscoveryEpoch) {
            return;
          }

          const discovered = await resolveGlazeWmIpcPort();
          if (!isActive(gen) || epoch !== rediscoveryEpoch) {
            return;
          }

          const action = decideGlazeWmReconnectAction(
            currentPort,
            discovered,
          );

          if (action === 'keep') {
            if (!loggedKeep) {
              console.info(
                `[glazewm-ipc] reconnect port=${currentPort}`,
              );
              loggedKeep = true;
            }
            continue;
          }

          console.info(
            `[glazewm-ipc] discovered changed ${currentPort} -> ${discovered}`,
          );
          await replaceClient(discovered);
          return;
        }
      } finally {
        // Clear only if this recovery still owns the flag so a newer
        // recovery cannot be clobbered. After replaceClient bumps
        // generation, we still own recoveringGen === gen and must clear
        // so the replacement client can rediscover on a later disconnect.
        if (recoveringGen === gen) {
          recoveringGen = null;
        }
      }
    }

    const initialPort = await resolveGlazeWmIpcPort();
    generation = 1;
    attachClient(initialPort, generation);

    return async () => {
      disposed = true;
      generation += 1;
      rediscoveryEpoch += 1;
      recoveringGen = null;
      const previous = client;
      client = null;
      await disposeClient(previous);
    };
  });
}
