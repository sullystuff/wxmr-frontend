// PM2 process config for the wXMR monorepo.
//
// Prereqs (from the repo root):
//   npm install
//   npm run build         # builds both apps. NEXT_PUBLIC_* are inlined at build
//                         # time from each app's .env / .env.local.
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
  ],
};
