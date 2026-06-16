interface LoadWxmrEnvResult {
  rootEnvPath: string;
  loaded: boolean;
}

declare const envLoader: {
  ENV_ALIASES: string[][];
  loadWxmrEnv(): LoadWxmrEnvResult;
};

export = envLoader;
