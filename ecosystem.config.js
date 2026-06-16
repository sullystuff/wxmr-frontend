// PM2 process config for the wXMR monorepo.
//
// Prereqs (from the repo root):
//   npm install
//   npm run build         # builds both apps. root .env values are normalized
//                         # into both NEXT_PUBLIC_* and server-side aliases.
//
// Start / persist:
//   pm2 start ecosystem.config.js
//   pm2 save              # snapshot the process list (after `pm2 startup`)
//
// Both servers bind to loopback only; Nginx (deploy/nginx/wxmr.conf) proxies
// wxmr.io -> :3000 and swap.wxmr.io -> :3001.

const path = require('path');

// `next` is hoisted to the workspace root by npm workspaces, so both apps
// share this single binary; each app is started from its own cwd.
const nextBin = path.resolve(__dirname, 'node_modules/next/dist/bin/next');
const orchestratorServer = path.resolve(__dirname, 'apps/orchestrator/dist/server.js');
const orchestratorWorker = path.resolve(__dirname, 'apps/orchestrator/dist/worker.js');

module.exports = {
  apps: [
    {
      name: 'wxmr-bridge',
      cwd: path.resolve(__dirname, 'apps/bridge'),
      script: nextBin,
      interpreter: 'node',
      args: 'start -H 127.0.0.1 -p 3000',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_memory_restart: '512M',
    },
    {
      name: 'wxmr-swap',
      cwd: path.resolve(__dirname, 'apps/swap'),
      script: nextBin,
      interpreter: 'node',
      args: 'start -H 127.0.0.1 -p 3001',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_memory_restart: '512M',
    },
    {
      name: 'wxmr-orchestrator',
      cwd: path.resolve(__dirname, 'apps/orchestrator'),
      script: orchestratorServer,
      interpreter: 'node',
      env: { NODE_ENV: 'production', ORCH_HOST: '127.0.0.1', ORCH_PORT: '3002' },
      autorestart: true,
      max_memory_restart: '512M',
    },
    {
      name: 'wxmr-orchestrator-worker',
      cwd: path.resolve(__dirname, 'apps/orchestrator'),
      script: orchestratorWorker,
      interpreter: 'node',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_memory_restart: '512M',
    },
  ],
};
