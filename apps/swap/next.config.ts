import type { NextConfig } from "next";
import path from "path";

// Standalone output (used only by the Docker image) runs heavy @vercel/nft
// dependency tracing across the whole monorepo, which can peg CPU and OOM-kill
// the build on small servers. It is OFF by default so `next start` / PM2 builds
// stay light; the Dockerfile opts in via NEXT_OUTPUT_STANDALONE=1.
const standalone = process.env.NEXT_OUTPUT_STANDALONE === "1";

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ["@wxmr/shared", "@wxmr/core"],
  ...(standalone
    ? {
        output: "standalone",
        // Trace from the monorepo root so the standalone build includes the
        // workspace @wxmr/shared package and hoisted dependencies.
        outputFileTracingRoot: path.join(__dirname, "../../"),
      }
    : {}),
};

export default nextConfig;
