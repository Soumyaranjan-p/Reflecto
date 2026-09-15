declare module "auto-launch" {
  interface AutoLaunchOptions {
    name: string;
    appName?: string;
    appPath?: string;
    isHidden?: boolean;
    mac?: { useLaunchAgent?: boolean };
    win?: {};
    linux?: {};
  }
  class AutoLaunch {
    constructor(options: AutoLaunchOptions);
    isEnabled(): Promise<boolean>;
    enable(): Promise<void>;
    disable(): Promise<void>;
  }
  export = AutoLaunch;
}
