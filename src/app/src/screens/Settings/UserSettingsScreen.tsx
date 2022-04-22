import { useCallback, useState } from "react";
import { AnchorButton, Button, Callout, Checkbox, ControlGroup, FormGroup, HTMLSelect, Icon, InputGroup, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import * as ReactIcon from "@mdi/react";
import { mdiEmoticonSad, mdiEmoticonWink } from "@mdi/js";

// project
import { LOGGING_LEVELS } from "../../Environment";
import { AppScreen, AppScreenProps, UserConfigurationOptions } from "../../Types";
import { ScreenHeader } from "./ScreenHeader";
import { Native } from "../../Native";
import { Notification } from "../../Notification";
import { useStoreActions, useStoreState } from "../../domain/types";

// module
import { ContainerEngineManager } from "./EngineManager";

import "./UserSettingsScreen.css";

// Screen

interface ScreenProps extends AppScreenProps {}

export const ID = "settings.user-settings";
export const View = "user-settings";
export const Title = "Settings";

export const Screen: AppScreen<ScreenProps> = () => {
  const [programPaths, setProgramPaths] = useState<{ [key: string]: any }>({});
  const { t } = useTranslation();
  const pending = useStoreState((state) => state.pending);
  const native = useStoreState((state) => state.native);
  const provisioned = useStoreState((state) => state.environment.provisioned);
  const system = useStoreState((state) => state.environment.system);
  const running = useStoreState((state) => state.environment.running);
  const userConfiguration = useStoreState((state) => state.environment.userConfiguration);
  const connect = useStoreActions((actions) => actions.connect);
  const setUserConfiguration = useStoreActions((actions) => actions.setUserConfiguration);
  const [socketPath, setSocketPath] = useState(userConfiguration.socketPath);
  const program = userConfiguration.program;
  const isValid = provisioned && program.currentVersion;
  const onProgramSelectClick = useCallback(
    async (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
      const sender = e.currentTarget as HTMLElement;
      const field = sender?.closest(".AppSettingsField");
      const program = field?.getAttribute("data-program-name");
      const result = await Native.getInstance().openFileSelector();
      if (result) {
        const filePath = result?.filePaths[0];
        if (!result.canceled && filePath && program) {
          try {
            const programSettings: any = {};
            const programKey = `program.${userConfiguration.program.name}.path`;
            programSettings[programKey] = filePath;
            await setUserConfiguration(programSettings);
            setProgramPaths((prev) => ({ ...prev, [program]: filePath }));
          } catch (error) {
            console.error("Unable to change program path", error);
            Notification.show({ message: t("Unable to change program path"), intent: Intent.DANGER });
          }
        }
      } else {
        console.error("Unable to open file dialog");
      }
    },
    [userConfiguration, setUserConfiguration, setProgramPaths, t]
  );
  const onProgramPathChange = useCallback(
    (event: React.FormEvent<HTMLInputElement>) => {
      const sender = event.currentTarget;
      const field = sender?.closest(".AppSettingsField");
      const program = field?.getAttribute("data-program-name");
      if (program) {
        setProgramPaths({ ...programPaths, [program]: sender.value });
      }
    },
    [programPaths]
  );
  const onSocketPathChange = useCallback(
    (event: React.FormEvent<HTMLInputElement>) => {
      const sender = event.currentTarget;
      setSocketPath(sender.value);
    },
    []
  );
  const onConnectClick = useCallback(
    async () => {
      await connect({ startApi: true });
    },
    [connect]
  );
  const onAutoStartApiChange = useCallback(async (e) => {
    await setUserConfiguration({ autoStartApi: !!e.currentTarget.checked });
  }, [setUserConfiguration]);
  const onMinimizeToSystemTray = useCallback(async (e) => {
    await setUserConfiguration({ minimizeToSystemTray: !!e.currentTarget.checked });
  }, [setUserConfiguration]);
  const onLoggingLevelChange = useCallback(async (e) => {
    const configuration: Partial<UserConfigurationOptions> = {};
    configuration["logging.level"] = e.currentTarget.value;
    await setUserConfiguration(configuration);
  }, [setUserConfiguration]);
  const onToggleInspectorClick = useCallback(async (e) => {
    Native.getInstance().openDevTools();
  }, []);

  let title = "";
  let errorMessage = "";
  let icon = mdiEmoticonSad;
  let reconnectActionText = t("Connect");
  if (program?.path) {
    title = t("The API is not running");
    errorMessage = t("Check the logs from application data path if this is not intended behavior");
    icon = mdiEmoticonWink;
    reconnectActionText = t("Connect and try to start the api");
  } else {
    title = t("Automatic detection failed");
    errorMessage = t("To be able to continue, all required programs need to be installed");
  }

  const contentWidget =
    provisioned && running ? null : (
      <Callout
        className="AppSettingsCallout"
        title={title}
        icon={<ReactIcon.Icon path={icon} size={3} />}
      >
        <p>{errorMessage}</p>
        <Button disabled={pending} fill text={reconnectActionText} icon={IconNames.REFRESH} onClick={onConnectClick} />
      </Callout>
    );

  let runningDetails: any = "";
  if (system) {
    runningDetails = t(
      "Running on {{distribution}} {{distributionVersion}} ({{kernel}})",
      {
        currentVersion: program.currentVersion,
        hostname: system.host?.hostname || "",
        distribution: system.host?.distribution?.distribution || "",
        distributionVersion: system.host?.distribution?.version || "",
        kernel: system.host?.kernel || ""
      }
    );
  } else {
    runningDetails = t("Unable to detect system - try to connect and start the api");
    if (program.name === "podman" && userConfiguration.engine === "virtualized" && !running) {
      runningDetails = (
        <>
          <span>{t("Unable to detect system - podman machine may need restart")}</span> &mdash;
          <code className="DocsCodeBox">podman machine stop &amp;&amp; podman machine start</code>
        </>
      );
    }
  }

  const isSocketPathChanged = socketPath !== userConfiguration.socketPath;

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader currentScreen={ID} />
      <div className="AppScreenContent">
        {contentWidget}
        <div className="AppSettingsForm" data-form="paths">
          <div
            className="AppSettingsField"
            data-field="program.path"
            data-program-name={program?.name}
            data-program-present={isValid ? "yes" : "no"}
          >
            <div className="AppSettingUserConfigurationPath">
              <Icon icon={IconNames.INFO_SIGN} />
              <strong>{t('Application settings and logs path')}</strong>
              <input type="text" value={userConfiguration.path} readOnly/>
            </div>
            <FormGroup
              helperText={
                <div className="AppSettingsFieldProgramHelper">
                  &nbsp;
                  {isValid ? (
                    <span>{t("Detected version {{currentVersion}}", program)}</span>
                  ) : program?.currentVersion ? (
                    t("The location of the {{program}} executable binary", { program: program?.name })
                  ) : (
                    t("Could not detect current version")
                  )}
                </div>
              }
              label={
                <AnchorButton
                  minimal
                  icon={isValid ? IconNames.THUMBS_UP : IconNames.THUMBS_DOWN}
                  intent={isValid ? Intent.SUCCESS : Intent.DANGER}
                  text={program.name}
                  title={t("Go to {{name}} homepage", program)}
                  target="_blank"
                  href={program.homepage || ""}
                />
              }
              labelFor={`${program.name}_path`}
              labelInfo={t("(required)")}
            >
              <ControlGroup fill={true} vertical={false}>
                <InputGroup
                  fill
                  id={`${program.name}_path`}
                  readOnly={native}
                  placeholder={"..."}
                  value={programPaths[program.name || ""] || program.path}
                  onChange={onProgramPathChange}
                />
                {native ? (
                  <Button
                    icon={IconNames.LOCATE}
                    text={t("Select")}
                    title={t("Select program")}
                    intent={Intent.PRIMARY}
                    onClick={onProgramSelectClick}
                  />
                ) : (
                  <Button icon={IconNames.TICK} title={t("Accept")} />
                )}
              </ControlGroup>
            </FormGroup>
            <FormGroup
              helperText={t("Using automatic value")}
              label={t("Socket path")}
              labelFor={`${program.name}_socket`}
              labelInfo={t("(required)")}
            >
              <ControlGroup fill={true} vertical={false}>
                <InputGroup
                  fill
                  id={`${program.name}_socket`}
                  placeholder={"..."}
                  value={socketPath}
                  onChange={onSocketPathChange}
                />
                <Button icon={IconNames.TICK} text={t("Accept")} title={isSocketPathChanged ? t("Try to use this path") : t("No change detected")} disabled={!isSocketPathChanged} intent={isSocketPathChanged ? Intent.SUCCESS : Intent.NONE} />
              </ControlGroup>
            </FormGroup>
          </div>
        </div>
        <ContainerEngineManager helperText={runningDetails} />
        <div className="AppSettingsForm" data-form="flags">
          <FormGroup
            label={t("Startup")}
            labelFor="autoStartApi"
            helperText={t("Not needed if container engine is already running as a service")}
          >
            <ControlGroup fill={true}>
              <Checkbox
                id="autoStartApi"
                disabled={pending}
                label={t("Automatically start the Api")}
                checked={!!userConfiguration.autoStartApi}
                onChange={onAutoStartApiChange}
              />
            </ControlGroup>
          </FormGroup>
          <FormGroup>
            <ControlGroup fill={true}>
              <Checkbox
                id="minimizeToSystemTray"
                disabled={pending}
                label={t("Minimize to System Tray when closing")}
                checked={!!userConfiguration.minimizeToSystemTray}
                onChange={onMinimizeToSystemTray}
              />
            </ControlGroup>
          </FormGroup>
        </div>
        <div className="AppSettingsForm" data-form="logging">
          <FormGroup
            label={t("Logging level")}
            labelFor="loggingLevel"
          >
            <ControlGroup>
              <HTMLSelect id="loggingLevel" disabled={pending} value={userConfiguration.logging.level} onChange={onLoggingLevelChange}>
                {LOGGING_LEVELS.map((level) => {
                  const key= `logging.${level}`;
                  return <option key={key} value={level}>{level}</option>;
                })}
              </HTMLSelect>
              <Button disabled={pending} icon={IconNames.SEARCH} text={t('Toggle inspector')} onClick={onToggleInspectorClick} />
            </ControlGroup>
          </FormGroup>
        </div>
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: `/screens/settings/${View}`
};
Screen.Metadata = {
  LeftIcon: IconNames.COG,
  ExcludeFromSidebar: true
};
