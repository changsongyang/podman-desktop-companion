import { isEmpty } from "lodash-es";

import {
  type ApiConnection,
  type ApiStartOptions,
  type CommandExecutionResult,
  type Connection,
  ContainerEngine,
  ContainerEngineHost,
  type ControllerScope,
  type EngineConnectorSettings,
  OperatingSystem,
  type RunnerStopperOptions,
  StartupStatus,
} from "@/env/Types";
import { getWindowsPipePath } from "@/platform";
import { userConfiguration } from "../../config";
import { PODMAN_PROGRAM } from "../../connection";
import { PodmanAbstractContainerEngineHostClient } from "./base";
import { getPodmanMachineInspect } from "./shared";

const PODMAN_API_SOCKET = `container-desktop-${PODMAN_PROGRAM}-rest-api.sock`;

export class PodmanContainerEngineHostClientVirtualizedVendor extends PodmanAbstractContainerEngineHostClient {
  static HOST = ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR;
  HOST = ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR;
  PROGRAM = PODMAN_PROGRAM;
  CONTROLLER = PODMAN_PROGRAM;
  ENGINE = ContainerEngine.PODMAN;

  static async create(id: string, osType: OperatingSystem) {
    const instance = new PodmanContainerEngineHostClientVirtualizedVendor(osType);
    instance.id = id;
    await instance.setup();
    return instance;
  }

  shouldKeepStartedScopeRunning() {
    return true; // Keep scope running as podman machines take a lot of time to stop/start
  }

  async getApiConnection(connection?: Connection, customSettings?: EngineConnectorSettings): Promise<ApiConnection> {
    let relay = "";
    const settings = customSettings || (await this.getSettings());
    const scope = settings.controller?.scope;
    if (isEmpty(scope)) {
      this.logger.error(this.id, "Unable to get api connection - no machine");
      return {
        uri: "",
        relay: "",
      };
    }
    let uri = await Path.join(await userConfiguration.getStoragePath(), PODMAN_API_SOCKET);
    if (this.osType === OperatingSystem.Windows) {
      uri = getWindowsPipePath(scope!);
    } else {
      const homeDir = await Platform.getHomeDir();
      uri = await Path.join(homeDir, ".local/share/containers/podman/machine/podman.sock");
      if (scope) {
        const machineSockPath = await Path.join(
          homeDir,
          ".local/share/containers/podman/machine",
          scope,
          "podman.sock",
        );
        if (await FS.isFilePresent(machineSockPath)) {
          uri = machineSockPath;
        }
      }
    }
    // Inspect machine for connection details - named pipe or unix socket
    try {
      const inspectResult = await getPodmanMachineInspect(this, customSettings);
      if (inspectResult?.ConnectionInfo?.PodmanPipe?.Path) {
        uri = inspectResult?.ConnectionInfo?.PodmanPipe?.Path || uri;
      } else {
        uri = inspectResult?.ConnectionInfo?.PodmanSocket?.Path || uri;
      }
    } catch (error: any) {
      this.logger.warn(this.id, "Unable to inspect machine", error);
    }
    if (this.isScoped()) {
      try {
        const info = await this.getSystemInfo(connection, undefined, settings);
        relay = info?.host?.remoteSocket?.path || "";
      } catch (error: any) {
        this.logger.warn(this.id, "Unable to get system info", error);
      }
    }
    return {
      uri,
      relay,
    };
  }
  async getControllerScopes(customSettings?: EngineConnectorSettings, skipAvailabilityCheck?: boolean) {
    return await this.getPodmanMachines(undefined, customSettings);
  }
  async getSystemConnections(customSettings?: EngineConnectorSettings) {
    const settings = customSettings || (await this.getSettings());
    const controllerPath = settings.controller?.path || settings.controller?.name;
    const commandArgs = ["system", "connection", "list", "--format", "json"];
    const command = await this.runHostCommand(controllerPath || this.CONTROLLER, commandArgs);
    if (command.success) {
      try {
        return JSON.parse(command.stdout || "[]");
      } catch (error: any) {
        this.logger.error(this.id, "Unable to parse connections", error, command);
      }
    } else {
      this.logger.error(this.id, "Unable to get connections", command);
    }
    return [];
  }
  async getControllerDefaultScope(customSettings?: EngineConnectorSettings): Promise<ControllerScope | undefined> {
    let defaultScope: ControllerScope | undefined;
    const connections = await this.getSystemConnections(customSettings);
    if (connections.length) {
      let defaultConnection = connections.find((it: any) => it.Default && it.IsMachine);
      if (!defaultConnection) {
        defaultConnection = connections[0];
      }
      const machines = await this.getPodmanMachines(undefined, customSettings);
      if (machines.length) {
        defaultScope = machines.find(
          (it) => it.Name?.trim().toLowerCase() === defaultConnection.Name?.trim().toLowerCase(),
        );
      } else {
        this.logger.error(this.id, "Unable to get default scope - no machines");
      }
    } else {
      this.logger.error(this.id, "Unable to get default scope - no connections or machines");
    }
    return defaultScope;
  }

  async startApi(customSettings?: EngineConnectorSettings, opts?: ApiStartOptions) {
    const running = await this.isApiRunning();
    if (running.success) {
      this.logger.debug(this.id, "API is already running");
      this.apiStarted = true;
      return true;
    }
    const settings = customSettings || (await this.getSettings());
    if (!settings?.controller?.scope) {
      this.logger.error(this.id, "API cannot start - controller scope is not available");
      return false;
    }
    // TODO: Safe to stop first before starting ?
    const controllerPath = settings.controller?.path || settings.controller?.name;
    const started = await this.runner.startApi(opts, {
      path: controllerPath,
      args: ["machine", "start", settings.controller.scope],
    });
    this.apiStarted = started;
    this.logger.debug(this.id, "Start API complete", started);
    return started;
  }
  async stopApi(customSettings?: EngineConnectorSettings, opts?: RunnerStopperOptions) {
    const settings = customSettings || (await this.getSettings());
    // Stop services
    try {
      this.logger.debug(this.id, "Stop api - stopping connection services", settings);
      await Command.StopConnectionServices(this.id, settings);
    } catch (e: any) {
      this.logger.error(this.id, "Stop api - failed to stop connection services", e);
    }
    this.logger.debug(this.id, "Stopping API - begin", settings);
    if (this.shouldKeepStartedScopeRunning()) {
      this.logger.debug(this.id, "Stopping API - skip (keep scope running)");
    } else {
      this.logger.warn(this.id, "Stopping API - perform");
      let args: string[] = opts?.args || [];
      if (!opts?.args) {
        if (!settings.controller?.scope) {
          this.logger.error(this.id, "Stopping API - scope is not set (no custom stop args)");
          return false;
        }
        args = ["machine", "stop", settings.controller?.scope];
      }
      this.logger.warn(this.id, "Stopping API - request stop from runner");
      const controllerPath = settings.controller?.path || settings.controller?.name;
      return await this.runner.stopApi(customSettings, {
        path: controllerPath,
        args,
      });
    }
    return false;
  }
  async startScope(scope: ControllerScope): Promise<StartupStatus> {
    this.logger.debug(this.id, "Starting scope", scope);
    const status = await this.startPodmanMachine(scope.Name);
    this.runner.setApiStarted(status === StartupStatus.RUNNING || status === StartupStatus.STARTED);
    return status;
  }
  async stopScope(scope: ControllerScope): Promise<boolean> {
    this.logger.debug(this.id, "Stopping scope", scope);
    return await this.stopPodmanMachine(scope.Name);
  }
  async startScopeByName(name: string): Promise<StartupStatus> {
    this.logger.debug(this.id, "Starting scope by name", name);
    const status = await this.startPodmanMachine(name);
    this.runner.setApiStarted(status === StartupStatus.RUNNING || status === StartupStatus.STARTED);
    return status;
  }
  async stopScopeByName(name: string): Promise<boolean> {
    this.logger.debug(this.id, "Stopping scope by name", name);
    return await this.stopPodmanMachine(name);
  }
  // Availability
  async isEngineAvailable() {
    const result = { success: true, details: "Engine is available" };
    return result;
  }
  isScoped() {
    return true;
  }
  async runScopeCommand(
    program: string,
    args: string[],
    scope: string,
    settings?: EngineConnectorSettings,
  ): Promise<CommandExecutionResult> {
    const { controller } = settings || (await this.getSettings());
    let command: string[] = [];
    if (!scope) {
      throw new Error("Unable to build scoped command - scope is not set");
    }
    command = ["machine", "ssh", scope, "-o", "LogLevel=ERROR"];
    if (program) {
      command.push(program);
    }
    if (args) {
      command.push(...args);
    }
    const hostLauncher = controller?.path || controller?.name || "";
    const hostArgs = [...command];
    return await this.runHostCommand(hostLauncher, hostArgs, settings);
  }
}
