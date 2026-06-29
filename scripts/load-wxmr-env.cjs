const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const REPO_ROOT = path.resolve(__dirname, "..");
const ROOT_ENV_PATH = path.join(REPO_ROOT, ".env");
const ROOT_LOCAL_ENV_PATH = path.join(REPO_ROOT, ".env.local");

const ENV_ALIASES = [
  ["NEXT_PUBLIC_SOLANA_RPC_URL", "SOLANA_RPC_URL"],
  ["NEXT_PUBLIC_BRIDGE_PROGRAM_ID", "BRIDGE_PROGRAM_ID"],
  ["NEXT_PUBLIC_JUPITER_API_KEY", "JUPITER_API_KEY"],
  ["NEXT_PUBLIC_JUPITER_REFERRAL_ACCOUNT", "JUPITER_REFERRAL_ACCOUNT"],
  ["NEXT_PUBLIC_JUPITER_REFERRAL_FEE", "JUPITER_REFERRAL_FEE"],
  ["NEXT_PUBLIC_ETHEREUM_RPC_URL", "ETHEREUM_RPC_URL"],
  ["NEXT_PUBLIC_BSC_RPC_URL", "BSC_RPC_URL"],
  ["NEXT_PUBLIC_BASE_RPC_URL", "BASE_RPC_URL"],
  ["NEXT_PUBLIC_ARBITRUM_RPC_URL", "ARBITRUM_RPC_URL"],
  ["NEXT_PUBLIC_OPTIMISM_RPC_URL", "OPTIMISM_RPC_URL"],
  ["NEXT_PUBLIC_POLYGON_RPC_URL", "POLYGON_RPC_URL"],
  ["NEXT_PUBLIC_AVALANCHE_RPC_URL", "AVALANCHE_RPC_URL"],
  ["NEXT_PUBLIC_LINEA_RPC_URL", "LINEA_RPC_URL"],
  ["NEXT_PUBLIC_HYPEREVM_RPC_URL", "HYPEREVM_RPC_URL"],
  ["NEXT_PUBLIC_MONAD_RPC_URL", "MONAD_RPC_URL"],
];

function firstDefined(names, sources) {
  for (const source of sources) {
    for (const name of names) {
      const value = source[name];
      if (value !== undefined && value !== "") {
        return value;
      }
    }
  }
  return undefined;
}

function loadWxmrEnv() {
  // NEXT_PUBLIC_* values are inlined at build time, so explicit build env wins.
  const initialEnv = { ...process.env };
  const cwdEnvPath = path.join(process.cwd(), ".env");
  const cwdLocalEnvPath = path.join(process.cwd(), ".env.local");
  const envPaths = uniquePaths([
    ROOT_ENV_PATH,
    ROOT_LOCAL_ENV_PATH,
    cwdEnvPath,
    cwdLocalEnvPath,
  ]);
  const parsedByPath = envPaths.map((envPath) => ({
    envPath,
    parsed: parseEnvFile(envPath),
  }));
  const parsedByResolvedPath = new Map(
    parsedByPath.map(({ envPath, parsed }) => [path.resolve(envPath), parsed])
  );
  const rootEnv = parsedByResolvedPath.get(path.resolve(ROOT_ENV_PATH)) ?? {};
  const rootLocalEnv = parsedByResolvedPath.get(path.resolve(ROOT_LOCAL_ENV_PATH)) ?? {};
  const cwdEnv = parsedByResolvedPath.get(path.resolve(cwdEnvPath)) ?? {};
  const cwdLocalEnv = parsedByResolvedPath.get(path.resolve(cwdLocalEnvPath)) ?? {};
  const parsed = Object.assign({}, cwdEnv, cwdLocalEnv, rootEnv, rootLocalEnv);

  for (const [key, value] of Object.entries(parsed)) {
    if (initialEnv[key] === undefined || initialEnv[key] === "") {
      process.env[key] = value;
    }
  }

  for (const names of ENV_ALIASES) {
    const value = firstDefined(names, [
      initialEnv,
      rootLocalEnv,
      rootEnv,
      cwdLocalEnv,
      cwdEnv,
      process.env,
    ]);
    if (value !== undefined) {
      for (const name of names) {
        process.env[name] = value;
      }
    }
  }

  return {
    rootEnvPath: ROOT_ENV_PATH,
    envPaths: parsedByPath
      .filter(({ parsed }) => Object.keys(parsed).length > 0)
      .map(({ envPath }) => envPath),
    loaded: Object.keys(parsed).length > 0,
  };
}

function uniquePaths(paths) {
  return Array.from(new Set(paths.map((envPath) => path.resolve(envPath))));
}

function parseEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return {};
  }
  return dotenv.parse(fs.readFileSync(envPath));
}

module.exports = {
  ENV_ALIASES,
  loadWxmrEnv,
};
