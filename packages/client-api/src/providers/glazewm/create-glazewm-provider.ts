import {
  WmClient,
  WmEventType,
  type BindingModesChangedEvent,
  type FocusChangedEvent,
  type FocusedContainerMovedEvent,
  type RunCommandResponse,
  type TilingDirectionChangedEvent,
  type UnlistenFn,
  type WorkspaceActivatedEvent,
  type WorkspaceDeactivatedEvent,
  type WorkspaceUpdatedEvent,
  type PauseChangedEvent,
  type WmEvent,
} from 'glazewm';
import { z } from 'zod';

import { getMonitors, shellExec } from '~/desktop';
import { getCoordinateDistance } from '~/utils';
import { createBaseProvider } from '../create-base-provider';
import type {
  GlazeWmProvider,
  GlazeWmProviderConfig,
} from './glazewm-provider-types';

const glazeWmProviderConfigSchema = z.object({
  type: z.literal('glazewm'),
});


async function resolveGlazeWmIpcPort(): Promise<number> {
  const DEFAULT_PORT = 6123;
  try {
    // GlazeWM writes ~/.glzr/glazewm/ipc.port when bound off the default
    // (ghost LISTENING on 6123). Official WmClient defaults to 6123 only.
    const result = await shellExec('cmd', [
      '/d',
      '/s',
      '/c',
      'if exist "%USERPROFILE%\.glzr\glazewm\ipc.port" (type "%USERPROFILE%\.glzr\glazewm\ipc.port")',
    ]);
    const raw = String(result.stdout ?? '').trim();
    const port = Number.parseInt(raw, 10);
    if (Number.isFinite(port) && port > 0) {
      return port;
    }
  } catch {
    // Missing shell permission or file: fall back to default.
  }
  return DEFAULT_PORT;
}

export function createGlazeWmProvider(
  config: GlazeWmProviderConfig,
): GlazeWmProvider {
  const mergedConfig = glazeWmProviderConfigSchema.parse(config);

  return createBaseProvider(mergedConfig, async queue => {
    const monitors = await getMonitors();
    const port = await resolveGlazeWmIpcPort();
    const client = new WmClient({ port });
    let unlistenEvents: null | UnlistenFn = null;

    client.onDisconnect(() =>
      queue.error('Failed to connect to GlazeWM IPC server.'),
    );

    client.onConnect(async () => {
      let state = await getInitialState();
      queue.output(state);

      unlistenEvents ??= await client.subscribe(WmEventType.ALL, onEvent);

      // TODO: Update state when monitors change.
      // monitors.onChange(async () => {
      //   state = { ...state, ...(await getMonitorState()) };
      //   queue.value(state);
      // });

      async function onEvent(e: WmEvent) {
        switch (e.eventType) {
          case WmEventType.BINDING_MODES_CHANGED: {
            state = { ...state, bindingModes: e.newBindingModes };
            break;
          }
          case WmEventType.FOCUS_CHANGED: {
            state = { ...state, focusedContainer: e.focusedContainer };
            state = { ...state, ...(await getMonitorState()) };

            const { tilingDirection } =
              await client.queryTilingDirection();
            state = { ...state, tilingDirection };
            break;
          }
          case WmEventType.FOCUSED_CONTAINER_MOVED: {
            state = { ...state, focusedContainer: e.focusedContainer };
            state = { ...state, ...(await getMonitorState()) };
            break;
          }
          case WmEventType.TILING_DIRECTION_CHANGED: {
            state = { ...state, tilingDirection: e.newTilingDirection };
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

        queue.output(state);
      }

      function runCommand(
        command: string,
        subjectContainerId?: string,
      ): Promise<RunCommandResponse> {
        return client.runCommand(command, subjectContainerId);
      }

      async function getInitialState() {
        const { focused: focusedContainer } = await client.queryFocused();
        const { bindingModes } = await client.queryBindingModes();
        const { tilingDirection } = await client.queryTilingDirection();
        const isPaused = await getIsPaused();

        return {
          ...(await getMonitorState()),
          focusedContainer,
          tilingDirection,
          bindingModes,
          isPaused,
          runCommand,
        };
      }

      // Paused state is only available on v3.7.0+ of GlazeWM.
      async function getIsPaused() {
        try {
          const { paused } = await client.queryPaused();
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

        const { monitors: glazeWmMonitors } = await client.queryMonitors();
        const { windows: glazeWmWindows } = await client.queryWindows();

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

    return () => {
      unlistenEvents?.();
      client.closeConnection();
    };
  });
}
