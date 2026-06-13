import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ["@wxmr/shared"],
  output: "standalone",
  // Trace files from the monorepo root so the standalone build includes
  // the workspace @wxmr/shared package and hoisted dependencies.
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
