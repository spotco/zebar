import {
  type TilingDirection,
  type BindingModeConfig,
  type Container,
  type Monitor,
  type RunCommandResponse,
  type Workspace,
  type Window,
} from 'glazewm';

import type { Provider } from '../create-base-provider';

export interface GlazeWmProviderConfig {
  type: 'glazewm';
}

/**
 * Direction fields exposed by the GlazeWM provider.
 *
 * `tilingDirection` remains the focused direction container for legacy
 * consumers. `globalTilingDirection` is the WM-wide insertion axis used by
 * spotcobuild chips and is kept independent when both values are present.
 */
export interface GlazeWmTilingDirectionState {
  tilingDirection: TilingDirection;
  globalTilingDirection: TilingDirection;
}

/**
 * Normalize the legacy/new GlazeWM query response without aliasing a local
 * direction to the global direction when the WM provides both fields.
 */
export function resolveGlazeWmTilingDirectionState(
  tiling: {
    tilingDirection: TilingDirection;
    globalTilingDirection?: TilingDirection;
  },
): GlazeWmTilingDirectionState {
  return {
    tilingDirection: tiling.tilingDirection,
    globalTilingDirection:
      tiling.globalTilingDirection ?? tiling.tilingDirection,
  };
}

export type GlazeWmProvider = Provider<
  GlazeWmProviderConfig,
  GlazeWmOutput
>;

export interface GlazeWmOutput {
  /**
   * Workspace displayed on the current monitor.
   */
  displayedWorkspace: Workspace;

  /**
   * Workspace that currently has focus (on any monitor).
   */
  focusedWorkspace: Workspace;

  /**
   * Workspaces on the current monitor.
   */
  currentWorkspaces: Workspace[];

  /**
   * Workspaces across all monitors.
   */
  allWorkspaces: Workspace[];

  /**
   * All monitors.
   */
  allMonitors: Monitor[];

  /**
   * All windows.
   */
  allWindows: Window[];

  /**
   * Monitor that currently has focus.
   */
  focusedMonitor: Monitor;

  /**
   * Monitor that is nearest to this Zebar widget.
   */
  currentMonitor: Monitor;

  /**
   * Container that currently has focus (on any monitor).
   */
  focusedContainer: Container;

  /**
   * Tiling direction of the focused container (legacy).
   * Spotcobuild chips should prefer `globalTilingDirection`.
   */
  tilingDirection: TilingDirection;

  /**
   * WM-wide insertion / stack axis (spotcobuild).
   * Falls back to `tilingDirection` when the WM build omits it.
   */
  globalTilingDirection: TilingDirection;

  /**
   * Active binding modes;
   */
  bindingModes: BindingModeConfig[];

  /**
   * Whether GlazeWM is currently paused.
   */
  isPaused: boolean;

  /**
   * Invokes a WM command (e.g. `"focus --workspace 1"`).
   *
   * @param command WM command to run (e.g. `"focus --workspace 1"`).
   * @param subjectContainerId (optional) ID of container to use as subject.
   * If not provided, this defaults to the currently focused container.
   * @throws If command fails.
   */
  runCommand(
    command: string,
    subjectContainerId?: string,
  ): Promise<RunCommandResponse>;
}
