import { isEmpty } from "lodash-es";

import {
  type ApiConnection,
  type ApiStartOptions,
  type AvailabilityCheck,
  type CommandExecutionResult,
  type Connection,
  type ControllerScope,
  type EngineConnectorSettings,
  OperatingSystem,
  type RunnerStopperOptions,
  StartupStatus,
} from "@/env/Types";
import { LIMA_PROGRAM } from "../../connection";
import { getAvailableLIMAInstances } from "../../shared";
import { AbstractContainerEngineHostClient } from "../abstract/base";

export abstract class AbstractContainerEngineHostClientVirtualizedLIMA extends AbstractContainerEngineHostClient {
  public CONTROLLER: string = LIMA_PROGRAM;
  public startedScopesMap: Map<string, boolean> = new Map<string, boolean>();
  shouldKeepStartedScopeRunning() {
    return true;
  }
  // Helpers
  async getApiConnection(connection?: Connection, customSettings?: EngineConnectorSettings): Promise<ApiConnection> {
    const settings = customSettings || (await this.getSettings());
    const scope = settings.controller?.scope;
    if (!scope) {
      this.logger.error(this.id, "getApiConnection requires a scope");
      return {
        uri: "",
        relay: "",
      };
    }
    const homeDir = await Platform.getHomeDir();
    const uri = await Path.join(homeDir, ".lima", scope, "sock", `${scope}.sock`);
    return {
      uri,
      relay: "",
    };
  }
  // Engine
  async startApi(customSettings?: EngineConnectorSettings, opts?: ApiStartOptions) {
    const running = await this.isApiRunning();
    if (running.success) {
      this.logger.debug(this.id, "API is already running");
      return true;
    }
    const settings = customSettings || (await this.getSettings());
    if (!settings.controller?.scope) {
      this.logger.error(this.id, "API cannot start - controller scope is not available");
      return false;
    }
    const controllerPath = settings.controller?.path || settings.controller?.name || "";
    // TODO: Safe to stop first before starting ?
    const started = await this.runner.startApi(opts, {
      path: controllerPath,
      args: ["start", settings.controller.scope],
    });
    this.apiStarted = started;
    this.logger.debug("Start API complete", started);
    return started;
  }
  async stopApi(customSettings?: EngineConnectorSettings, opts?: RunnerStopperOptions) {
    const settings = customSettings || (await this.getSettings());
    await Command.StopConnectionServices(this.id, settings);
    if (!this.apiStarted) {
      this.logger.debug("Stopping API - skip(not started here)");
      return false;
    }
    this.logger.debug("Stopping API - begin");
    let args: string[] = opts?.args || [];
    if (!opts?.args) {
      if (!settings.controller?.scope) {
        this.logger.error("Stopping API - scope is not set (no custom stop args)");
        return false;
      }
      args = ["stop", settings.controller?.scope];
    }
    const controllerPath = settings.controller?.path || settings.controller?.name || "";
    return await this.runner.stopApi(settings, {
      path: opts?.path || controllerPath,
      args,
    });
  }
  async startScope(scope: ControllerScope): Promise<StartupStatus> {
    const check = await this.startLIMAInstance(scope.Name);
    return check;
  }
  async stopScope(scope: ControllerScope): Promise<boolean> {
    const check = await this.stopLIMAInstance(scope.Name);
    return check;
  }
  async startScopeByName(name: string): Promise<StartupStatus> {
    return await this.startLIMAInstance(name);
  }
  async stopScopeByName(name: string): Promise<boolean> {
    return await this.stopLIMAInstance(name);
  }
  // Availability
  isScoped() {
    return true;
  }

  async isEngineAvailable(): Promise<AvailabilityCheck> {
    const result = { success: true, details: "Engine is available" };
    if (this.osType !== OperatingSystem.MacOS) {
      result.success = false;
      result.details = `Engine is not available on ${this.osType}`;
    }
    return result;
  }
  // Services
  async getControllerScopes(customSettings?: EngineConnectorSettings, skipAvailabilityCheck?: boolean) {
    const settings = customSettings || (await this.getSettings());
    const available = await this.isEngineAvailable();
    const controllerPath = settings.controller?.path || settings.controller?.name || "";
    const canListScopes = available.success && !isEmpty(controllerPath);
    const items = canListScopes ? await getAvailableLIMAInstances(controllerPath) : [];
    return items;
  }

  async getControllerDefaultScope(customSettings?: EngineConnectorSettings): Promise<ControllerScope | undefined> {
    const scopes = await this.getControllerScopes(customSettings, true);
    if (scopes.length > 0) {
      if (customSettings?.controller?.scope) {
        const matchingScope = scopes.find((s) => s.Name === customSettings?.controller?.scope);
        return matchingScope;
      }
      this.logger.error(this.id, "Controller scope is not set", customSettings);
    } else {
      this.logger.error(this.id, "No controller scopes available - no LIMA instances present", customSettings);
    }
    return undefined;
  }

  async getSystemInfo(connection?: Connection, customFormat?: string, customSettings?: EngineConnectorSettings) {
    return super.getSystemInfo(connection, customFormat || "json", customSettings);
  }

  // Executes command inside controller scope
  async runScopeCommand(
    program: string,
    args: string[],
    scope: string,
    settings?: EngineConnectorSettings,
  ): Promise<CommandExecutionResult> {
    const { controller } = settings || (await this.getSettings());
    const hostLauncher = controller?.path || controller?.name || "";
    const hostArgs = ["shell", scope, program, ...args];
    return await this.runHostCommand(hostLauncher, hostArgs, settings);
  }
  // LIMA specific
  async startLIMAInstance(name: string): Promise<StartupStatus> {
    const scopes = await this.getControllerScopes();
    const matchingScope = scopes.find((scope) => scope.Name === name);
    if (matchingScope) {
      if (matchingScope.Usable) {
        this.logger.warn(this.id, `LIMA instance ${name} is already running`);
        return StartupStatus.RUNNING;
      }
      const { controller } = await this.getSettings();
      const programLauncher = controller?.path || controller?.name || LIMA_PROGRAM;
      const check = await this.runHostCommand(programLauncher, ["start", name]);
      return check.success ? StartupStatus.STARTED : StartupStatus.ERROR;
    }
    this.logger.error(this.id, `LIMA instance ${name} not found`);
    return StartupStatus.ERROR;
  }

  async stopLIMAInstance(name: string): Promise<boolean> {
    return true;
  }
}
